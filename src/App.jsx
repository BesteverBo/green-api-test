import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'green-api-chat-demo'

const defaultCredentials = {
  idInstance: '',
  apiTokenInstance: '',
  recipientPhone: '',
}

const normalizeChatId = (value) => {
  if (!value) return ''

  const trimmed = String(value).trim()
  if (trimmed.includes('@')) return trimmed

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  const normalized = digits.startsWith('8') ? `7${digits.slice(1)}` : digits
  return `${normalized}@c.us`
}

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const parseJsonSafely = async (response) => {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function App() {
  const [credentials, setCredentials] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultCredentials

    try {
      return { ...defaultCredentials, ...JSON.parse(saved) }
    } catch {
      return defaultCredentials
    }
  })
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('Введите учетные данные Green API и начните диалог.')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'system',
      direction: 'system',
      text: 'Здесь будет отображаться ваш чат с MAX.',
      timestamp: Date.now(),
    },
  ])
  const [chatName, setChatName] = useState('Новый чат')

  const recipientChatId = useMemo(
    () => normalizeChatId(credentials.recipientPhone),
    [credentials.recipientPhone],
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials))
  }, [credentials])

  const deleteNotification = async (receiptId) => {
    if (!receiptId || !credentials.idInstance || !credentials.apiTokenInstance) {
      return
    }

    try {
      await fetch(
        `https://api.green-api.com/waInstance${credentials.idInstance}/deleteNotification/${credentials.apiTokenInstance}/${receiptId}`,
        { method: 'DELETE' },
      )
    } catch {
      // ignore async cleanup errors to keep the polling loop stable
    }
  }

  const pollIncomingMessages = async () => {
    if (!credentials.idInstance || !credentials.apiTokenInstance) {
      return
    }

    try {
      const response = await fetch(
        `https://api.green-api.com/waInstance${credentials.idInstance}/receiveNotification/${credentials.apiTokenInstance}`,
      )

      if (response.status === 204 || response.status === 404) {
        return
      }

      if (!response.ok) {
        setStatus('Не удалось получить входящее сообщение.')
        return
      }

      const payload = await parseJsonSafely(response)
      if (!payload) {
        return
      }

      const receiptId = payload?.receiptId
      const incomingText = payload?.body?.messageData?.textMessageData?.textMessage
      const senderChatId = payload?.body?.senderData?.chatId

      if (!receiptId || !incomingText) {
        if (receiptId) {
          await deleteNotification(receiptId)
        }
        return
      }

      const incomingMessage = {
        id: receiptId,
        sender: senderChatId || 'Получатель',
        direction: 'incoming',
        text: incomingText,
        timestamp: (payload?.body?.timestamp || Date.now() / 1000) * 1000,
      }

      setMessages((prev) => {
        if (prev.some((message) => message.id === incomingMessage.id)) {
          return prev
        }

        return [...prev, incomingMessage]
      })
      setStatus(`Новое сообщение от ${senderChatId || 'получателя'}`)
      await deleteNotification(receiptId)
    } catch (error) {
      setStatus(`Ошибка при получении сообщений: ${error.message}`)
    }
  }

  useEffect(() => {
    if (!credentials.idInstance || !credentials.apiTokenInstance) {
      return undefined
    }

    const timer = setInterval(() => {
      pollIncomingMessages()
    }, 3000)

    return () => clearInterval(timer)
  }, [credentials.idInstance, credentials.apiTokenInstance])

  const createNewChat = () => {
    if (!credentials.recipientPhone.trim()) {
      setStatus('Введите номер телефона получателя.')
      return
    }

    setChatName(credentials.recipientPhone.trim())
    setMessages([
      {
        id: `new-chat-${Date.now()}`,
        sender: 'system',
        direction: 'system',
        text: `Чат с ${credentials.recipientPhone.trim()} создан.`,
        timestamp: Date.now(),
      },
    ])
    setDraft('')
    setStatus('Чат создан. Можно отправлять сообщения.')
  }

  const handleSendMessage = async () => {
    const trimmedMessage = draft.trim()

    if (!credentials.idInstance || !credentials.apiTokenInstance) {
      setStatus('Введите idInstance и apiTokenInstance.')
      return
    }

    if (!trimmedMessage) {
      setStatus('Введите текст сообщения.')
      return
    }

    if (!recipientChatId) {
      setStatus('Введите корректный номер телефона получателя.')
      return
    }

    const newOutgoingMessage = {
      id: `outgoing-${Date.now()}`,
      sender: 'me',
      direction: 'outgoing',
      text: trimmedMessage,
      timestamp: Date.now(),
    }

    setLoading(true)
    setMessages((prev) => [...prev, newOutgoingMessage])
    setDraft('')

    try {
      const response = await fetch(
        `https://api.green-api.com/waInstance${credentials.idInstance}/sendMessage/${credentials.apiTokenInstance}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chatId: recipientChatId,
            message: trimmedMessage,
          }),
        },
      )

      if (!response.ok) {
        const errorPayload = (await parseJsonSafely(response)) || {}
        throw new Error(errorPayload?.message || `Ошибка ${response.status}`)
      }

      setStatus('Сообщение успешно отправлено.')
    } catch (error) {
      setStatus(`Ошибка отправки: ${error.message}`)
      setMessages((prev) =>
        prev.map((message) =>
          message.id === newOutgoingMessage.id
            ? {
                ...message,
                failed: true,
                text: `Не отправлено: ${error.message}`,
              }
            : message,
        ),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-mark">MAX</div>
          <div>
            <h1>Чаты</h1>
          </div>
        </div>

        <div className="credentials-panel">
          <label>
            idInstance
            <input
              type="text"
              value={credentials.idInstance}
              onChange={(event) =>
                setCredentials((prev) => ({
                  ...prev,
                  idInstance: event.target.value.trim(),
                }))
              }
              placeholder="Введите idInstance"
            />
          </label>

          <label>
            apiTokenInstance
            <input
              type="text"
              value={credentials.apiTokenInstance}
              onChange={(event) =>
                setCredentials((prev) => ({
                  ...prev,
                  apiTokenInstance: event.target.value.trim(),
                }))
              }
              placeholder="Введите apiTokenInstance"
            />
          </label>

          <label>
            Номер получателя
            <input
              type="tel"
              value={credentials.recipientPhone}
              onChange={(event) =>
                setCredentials((prev) => ({
                  ...prev,
                  recipientPhone: event.target.value,
                }))
              }
              placeholder="Например, 79991234567"
            />
          </label>

          <button type="button" className="primary-button" onClick={createNewChat}>
            Создать чат
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div className="avatar">{chatName.charAt(0).toUpperCase() || 'N'}</div>
          <div className="chat-title-block">
            <h2>{chatName || 'Новый чат'}</h2>
            <span>{status}</span>
          </div>
        </header>

        <div className="messages-wrap">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message-row ${message.direction === 'outgoing' ? 'outgoing' : 'incoming'}`}
            >
              <div className="message-bubble">
                <p>{message.text}</p>
                <span>{formatTime(message.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="composer">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleSendMessage()
              }
            }}
            placeholder="Напишите сообщение..."
          />
          <button type="button" onClick={handleSendMessage} disabled={loading}>
            {loading ? 'Отправка...' : 'Отправить'}
          </button>
        </div>
      </main>
    </div>
  )
}

export default App
