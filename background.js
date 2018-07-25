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
  // logState(state)
  if (state === 'active' && ws.readyState === WebSocket.CLOSED && navigator.onLine) {
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
    chrome.notifications.create('error', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Error',
      message: e.message,
      requireInteraction: true
    })
  }
}

async function connectWithOrganization(organization) {
  // if (!organization) {
  //   throw new Error('Organization must be provided')
  // }
  const url = `https://${organization}.ryver.com/api/1/odata.svc/Ryver.Info()?$format=json`
  const response = await fetch(url, {credentials: 'include'})
  if (response.status !== 200) {
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

  function onOpen() {
    // logState('ws_open')

    chrome.storage.local.remove('retryCount')
    chrome.notifications.clear('reconnect')

    chrome.browserAction.setBadgeText({text: ''})
    chrome.browserAction.setTitle({title: 'Connected'})

    ws.send(JSON.stringify({
      id: nextId(),
      type: 'auth',
      authorization: 'Session tnt255:' + info.me.id + ':89bbf0b80596dfb70f96905b2c72aafd509b7791',
      agent: 'Ryver',
      resource: 'Contatta-1496207329078'
    }))

    ws.send(JSON.stringify({
      presence: 'unavailable',
      type: 'presence_change'
    }))
  }

  function onClose() {
    // logState('ws_close')
    reset()

    chrome.idle.queryState(60, state => {
      if (state === 'active' && navigator.onLine) {
        chrome.storage.local.get('retryCount', ({retryCount}) => {
          if (typeof retryCount === 'undefined') {
            retryCount = 0
          }
          if (retryCount < 3) {
            chrome.storage.local.set({retryCount: retryCount + 1})
            console.log('retrying')
            connect()
          } else {
            chrome.notifications.create('reconnect', {type: 'basic', iconUrl: 'icon.png', title: 'disconnected', message: 'reconnect?'})
            console.log('try to reconnect?')
          }
        })
      }
    })
  }

  function onMessage(event) {
    const data = JSON.parse(event.data)
    const {type} = data

    if (['presence_change'].includes(type)) {
      const {client, from: fromId, presence, received} = data
      const from = findEntity(fromId)
      const {descriptor} = from
      log([dateToString(new Date(received)), type, descriptor, presence, client].join(' '))
      users[fromId] = {descriptor, received, presence, from}
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
      }, storeNotificationMetadata({from, to}))
    }

    else if (['chat'].includes(type)) {
      const [from, to] = findEntities(data.from, data.to)
      log([type, from.descriptor, '➔', to.descriptor, ':', data.text].join(' '), data)
      addChatMessage(data)
      notify({
        title: [from.descriptor, '➔', to.descriptor].join(' '),
        message: data.text,
        iconUrl: from.avatarUrl
      }, storeNotificationMetadata({from, to}))
    }

    else if (['chat_deleted', 'chat_updated'].includes(type)) {
      log(data)
      addChatMessage(data)
    }

    else {
      if (!['ack', 'event'].includes(type)) {
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

chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  console.log({notificationId, byUser})
})

async function handleNotificationClick(notificationId) {
  if (notificationId === 'unreadTabs') {
    const {organization, unreadTabs} = await browser.storage.local.get(['organization', 'unreadTabs'])
    const {id, __metadata: {type}} = unreadTabs[0].entity
    const entityType = type === 'Entity.Workroom' ? 'teams' : 'users'
    const url = `https://${organization}.ryver.com/index.html#${entityType}/${id}`
    chrome.tabs.create({url})
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

// for development
// function logState(...message) {
//   chrome.idle.queryState(60, state =>
//     log(...message,
//       state,
//       ['connecting', 'open', 'closing', 'closed'][ws.readyState],
//       navigator.onLine ? 'online' : 'offline'
//     )
//   )
// }

function log(...message) {
  console.log(...message)
}


// window.addEventListener('online', () => logState('online'))
// window.addEventListener('offline', () => logState('offline'))

function chromePromises() {
  return {
    storage: {
      local: {
        get: keys => new Promise((resolve, reject) => {
          chrome.storage.local.get(keys, items => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
            else resolve(items)
          })
        })
      }
    }
  }
}
