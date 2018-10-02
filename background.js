const browser = chromePromises()
let ws, chatMessages, notifications, users

main()

function main() {
  reset()
  if (navigator.onLine) {
    connect()
  }
}

chrome.idle.onStateChanged.addListener(state => {
  console.log(`state=${state}`)
  if (state === 'active' && navigator.onLine && (!ws || ws.readyState === WebSocket.CLOSED)) {
    connect()
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && Object.keys(changes).includes('organization')) {
    log('organization_changed', changes.organization.newValue)
    ws.close()
    tryConnectWithOrganization(changes.organization.newValue)
  }
})

function reset() {
  localStorage.setItem('unreadCount', 0)

  chrome.storage.local.get('notifications', items => notifications = items.notifications || {})
  chatMessages = []
  users = {}
  chrome.storage.local.set({chatMessages, users})
  chrome.storage.local.remove('info')
  chrome.browserAction.setBadgeText({text: '!'})
  chrome.browserAction.setTitle({title: 'Disconnected'})
}

function connect() {
  chrome.storage.local.get('organization', ({organization}) => tryConnectWithOrganization(organization))
}

async function tryConnectWithOrganization(organization) {
  try {
    await connectWithOrganization(organization)
  } catch (e) {
    chrome.notifications.create('reconnect', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Error',
      message: e.message,
      requireInteraction: true
    })
  }
}

async function connectWithOrganization(organization) {
  const url = `https://${organization}.ryver.com/api/1/odata.svc/Ryver.Info()?$format=json`
  const response = await fetch(url, {credentials: 'include'})
  if (! response.ok) {
    throw new Error(response.statusText)
  }
  const info = await response.json().then(json => json.d)
  chrome.storage.local.set({info})
  ws = createWebSocket(info)
  checkUnreadTabs(organization)
}

async function checkUnreadTabs(organization) {
  const unreadTabs = await getUnreadTabs(organization)
  if (unreadTabs.length > 0) {
    const descriptors = unreadTabs
      .sort(orderByDesc(unreadTab => unreadTab.lastMessageDate))
      .map(unreadTab => unreadTab.entity.__descriptor)
      .join(' • ');

    log('unreadTabs', descriptors, unreadTabs)
    chrome.storage.local.set({unreadTabs})
    chrome.notifications.clear('unreadTabs')
    chrome.notifications.create('unreadTabs', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: unreadTabs.length + ' unread',
      message: descriptors,
      requireInteraction: true
    })
  }
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

  const ws = new WebSocket('wss://prdchat.ryver.com/apt38/1/ratatoskr')
  ws.onopen = onOpen
  ws.onclose = onClose
  ws.onmessage = onMessage
  return ws

  async function onOpen() {
    console.log('ws open')

    const cookie = await browser.cookies.get({ url: 'https://mrlabs.ryver.com', name: 'PHPSESSID' })
    const sessionId = decodeURIComponent(cookie.value)

    ws.send(JSON.stringify({
      id: nextId(),
      type: 'auth',
      authorization: 'Session ' + sessionId,
      agent: 'Ryver',
      resource: 'Contatta-1496207329078'
    }))
  }

  async function onClose() {
    console.log('ws closed')
    reset()

    const { retryCount = 0 } = await browser.storage.local.get('retryCount')

    const state = await browser.idle.queryState(60)
    console.log(`retry state=${state} navigator.onLine=${navigator.onLine}`)

    if (retryCount < 2 && navigator.onLine) { // TODO: need to check state?
      chrome.storage.local.set({ retryCount: retryCount + 1 })
      connect()
    } else {
      chrome.notifications.create('reconnect', {
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'WS Closed',
        message: 'Reconnect?',
        requireInteraction: true
      })
    }
  }

  function onMessage(event) {
    const data = JSON.parse(event.data)
    const {type} = data

    if (type === 'ack') {
      log('ack', data)
      chrome.storage.local.remove('retryCount')
      chrome.notifications.clear('reconnect')

      chrome.browserAction.setBadgeText({text: ''})
      chrome.browserAction.setTitle({title: 'Connected'})

      ws.send(JSON.stringify({
        presence: 'unavailable',
        type: 'presence_change'
      }))
    }

    else if (type === 'presence_change') {
      const {client, from: fromId, presence, received} = data
      const from = findEntity(fromId) || {descriptor: fromId}
      const {descriptor} = from
      log([dateToString(new Date(received)), type, descriptor, presence, client].join(' '))
      users[fromId] = {descriptor, received, presence, from}
      chrome.storage.local.set({users})
    }

    else if (type === 'user_typing') {
      const [from, to] = findEntities(data.from, data.to)
      log([type, from.descriptor, '➔', to.descriptor, ':', data.state].join(' '))
      addChatMessage(data)
      notify({
        title: [from.descriptor, '➔', to.descriptor].join(' '),
        message: [type, ':', data.state].join(' '),
        iconUrl: from.avatarUrl
      }, storeNotificationMetadata({from, to}))
    }

    else if (type === 'chat') {
      const [from, to] = findEntities(data.from, data.to)
      log([type, from.descriptor, '➔', to.descriptor, ':', data.text].join(' '), data)
      addChatMessage(data)
      const fromDescriptor = data.createSource ? data.createSource.displayName : from.descriptor
      const fromAvatarUrl = data.createSource ? data.createSource.avatar : from.avatarUrl
      notify({
        title: [fromDescriptor, '➔', to.descriptor].join(' '),
        message: data.text,
        iconUrl: fromAvatarUrl
      }, storeNotificationMetadata({from, to}))
    }

    else if (['chat_deleted', 'chat_updated'].includes(type)) {
      log(data)
      addChatMessage(data)
    }

    else if (type === 'voice_change') {
      log(data)
      const {client, from: fromId, presence, received} = data
      const from = findEntity(fromId) || {descriptor: fromId}
      console.log('from', from)
      chrome.notifications.create({
        type: 'basic',
        iconUrl: from.avatarUrl || 'icon.png',
        title: 'voice_change',
        message: from.descriptor
      })
    }

    else {
      if (!['event'].includes(type)) {
        log(data)
        notify({
          title: 'unhandled event: ' + type,
          message: event.data
        })
      }
    }

    function storeNotificationMetadata(metadata) {
      return notificationId => {
        notifications[notificationId] = metadata
        chrome.storage.local.set({notifications})
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

  const oldUnreadCount = parseInt(localStorage.getItem('unreadCount'))
  const newUnreadCount = oldUnreadCount + 1
  localStorage.setItem('unreadCount', newUnreadCount)

  chrome.browserAction.setBadgeText({text: newUnreadCount.toString()})
}

function notify({type = 'basic', iconUrl, title, message}, callback) {
  chrome.notifications.create({type, iconUrl: iconUrl || 'icon.png', title, message}, callback)
}

chrome.notifications.onClicked.addListener(handleNotificationClick)
chrome.notifications.onButtonClicked.addListener(handleNotificationClick)

// chrome.notifications.onClosed.addListener((notificationId, byUser) => {
//   console.log({notificationId, byUser})
// })

function getEntityType(type) {
  switch (type) {
    case 'Entity.Forum':
      return 'forums'
    case 'Entity.Workroom':
      return 'teams'
    default:
      return 'users'
  }
}

async function handleNotificationClick(notificationId) {
  if (notificationId === 'unreadTabs') {
    const {organization, unreadTabs} = await browser.storage.local.get(['organization', 'unreadTabs'])
    const {id, __metadata: {type}} = unreadTabs[0].entity
    const entityType = getEntityType(type)
    const url = `https://${organization}.ryver.com/index.html#${entityType}/${id}`
    chrome.tabs.create({url})
    chrome.notifications.clear(notificationId)
  } else if (notificationId === 'reconnect') {
    connect()
    chrome.notifications.clear(notificationId)
  } else {
    const {info, notifications, organization} = await browser.storage.local.get(['info', 'notifications', 'organization'])
    const notification = notifications[notificationId]
    if (notification) {
      const target = notification.to.entityType === 'teams' || notification.from.id === info.me.id ? notification.to : notification.from
      const {entityType, id} = target
      const url = `https://${organization}.ryver.com/index.html#${entityType}/${id}`
      chrome.tabs.create({url})
    } else {
      const url = `https://${organization}.ryver.com`
      chrome.tabs.create({url})
    }
  }
}

function log(...message) {
  console.log(...message)
}

window.addEventListener('error', event => {
  console.log('error', event)
  chrome.notifications.create('error', {
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'Error',
    message: event.message,
    requireInteraction: true
  })
})
