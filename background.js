let ws, chatMessages, users

main()

function main() {
  reset()
  if (navigator.onLine) {
    connect()
  }
}

chrome.idle.onStateChanged.addListener(state => {
  logState(state)
  if (state === 'active' && ws.readyState === WebSocket.CLOSED && navigator.onLine) {
    connect()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && Object.keys(changes).includes('organization')) {
    log('organization_changed', changes.organization.newValue)
    ws.close()
    connectWithOrganization(changes.organization.newValue)
  }
})

function reset() {
  chatMessages = []
  users = {}
  chrome.storage.local.set({chatMessages, users})
  chrome.storage.local.remove('info')
  chrome.browserAction.setBadgeText({text: '!'})
  chrome.browserAction.setTitle({title: 'Disconnected'})
}

function connect() {
  chrome.storage.local.get('organization', ({organization}) => connectWithOrganization(organization))
}

async function connectWithOrganization(organization) {
  if (!organization) {
    throw new Error('Organization must be provided')
  }
  const info = await getInfo(organization).then(minimizeInfo)
  chrome.storage.local.set({info})
  ws = createWebSocket(info)
  checkUnreadTabs(organization)
}

async function checkUnreadTabs(organization) {
  const unreadTabs = await getUnreadTabs(organization)

  const onUnreadTabs = () => {
    const descriptors = unreadTabs
      .sort(orderByDesc(unreadTab => unreadTab.lastMessageDate))
      .map(unreadTab => unreadTab.entity.__descriptor)
      .join(' • ');
    if (unreadTabs.length > 0) {
      log('unreadTabs', descriptors, unreadTabs)
      notify({
        title: unreadTabs.length + ' unread',
        message: descriptors
      }, unreadNotificationId => chrome.storage.local.set({unreadNotificationId}))
    }
  }

  chrome.storage.local.get('unreadNotificationId', ({unreadNotificationId}) => {
    if (unreadNotificationId) {
      chrome.notifications.clear(unreadNotificationId, onUnreadTabs)
    } else {
      onUnreadTabs()
    }
  })
}

async function getInfo(organization) {
  const url = `https://${organization}.ryver.com/api/1/odata.svc/Ryver.Info()?$format=json`
  return await fetch(url, {credentials: 'include'}).then(res => res.json()).then(json => json.d)
}

async function getTabsState(organization) {
  const url = `https://${organization}.ryver.com/api/1/odata.svc/Tabs.GetState()`
  return await fetch(url, {credentials: 'include'}).then(res => res.json()).then(json => json.d)
}

async function getUnreadTabs(organization) {
  const tabsState = await getTabsState(organization)
  return Object.values(tabsState).filter(tab => tab.lastMessageId > tab.lastReadId)
}

function minimizeInfo({forums, me, teams, users}) {
  const minimizeFields = ({avatarUrl, descriptor, id, jid}) => ({avatarUrl, descriptor, id, jid})
  return {
    me: {id: me.id},
    forums: forums.map(minimizeFields),
    teams: teams.map(minimizeFields),
    users: users.map(minimizeFields)
  }
}

function createWebSocket(info) {
  const {findEntity, findEntities} = ryverLibrary(info)

  const ws = new WebSocket('wss://chat.ryver.com/apt38/1/ratatoskr')
  ws.onopen = onOpen
  ws.onclose = onClose
  ws.onmessage = onMessage
  return ws

  function onOpen() {
    logState('ws_open')
    chrome.browserAction.setBadgeText({text: ''})
    chrome.browserAction.setTitle({title: 'Connected'})

    ws.send(JSON.stringify({
      id: nextId(),
      type: 'auth',
      authorization: 'Session tnt255:' + info.me.id + ':0e507588c70ec8e5b5707542ea04b2621efa1574',
      agent: 'Ryver',
      resource: 'Contatta-1496207329078'
    }))

    ws.send(JSON.stringify({
      presence: 'unavailable',
      type: 'presence_change'
    }))
  }

  function onClose() {
    logState('ws_close')
    reset()

    chrome.idle.queryState(60, state => {
      if (state === 'active' && navigator.onLine) {
        connect()
      }
    })
  }

  function onMessage(event) {
    const data = JSON.parse(event.data)
    const {type} = data

    if (['presence_change'].includes(type)) {
      const {received, from, presence, client} = data
      const {descriptor} = findEntity(from)
      log([dateToString(new Date(received)), type, descriptor, presence, client].join(' '))
      users[from] = {descriptor, received, presence}
      chrome.storage.local.set({users})
    }

    else if (['user_typing'].includes(type)) {
      const [from, to] = findEntities(data.from, data.to)
      log([type, from.descriptor, '➔', to.descriptor, ':', data.state].join(' '))
      addChatMessage(data)
      notify({
        title: [from.descriptor, '➔', to.descriptor].join(' '),
        message: [type, ':', data.state].join(' '),
        iconUrl: from.avatarUrl
      })
    }

    else if (['chat'].includes(type)) {
      const [from, to] = findEntities(data.from, data.to)
      log([type, from.descriptor, '➔', to.descriptor, ':', data.text].join(' '), data)
      addChatMessage(data)
      notify({
        title: [from.descriptor, '➔', to.descriptor].join(' '),
        message: data.text,
        iconUrl: from.avatarUrl
      })
    }

    else if (['chat_deleted', 'chat_updated'].includes(type)) {
      log(data)
      addChatMessage(data)
    }

    else {
      log(data)
      if (!['ack', 'event'].includes(type)) {
        notify({
          title: 'unhandled event: ' + type,
          message: event.data
        })
      }
    }
  }
}

function nextId() {
  return 'BkD971TWZ'
}

function addChatMessage(data) {
  const time = new Date().toISOString()
  chatMessages.push({time, data})
  chrome.storage.local.set({chatMessages})
  chrome.browserAction.setBadgeText({text: chatMessages.length.toString()})
}

function notify({type = 'basic', iconUrl, title, message}, callback) {
  chrome.notifications.create({type, iconUrl: iconUrl || 'icon.png', title, message}, callback)
}

// for development
function logState(...message) {
  chrome.idle.queryState(60, state =>
    log(...message,
      state,
      ['connecting', 'open', 'closing', 'closed'][ws.readyState],
      navigator.onLine ? 'online' : 'offline'
    )
  )
}

function log(...message) {
  console.log(dateToString(new Date()), ...message)
}


window.addEventListener('online', () => logState('online'))
window.addEventListener('offline', () => logState('offline'))
