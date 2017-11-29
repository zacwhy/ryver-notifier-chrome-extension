const {a, div, span} = hyperscriptHelpers(h)

let organization

document.addEventListener('DOMContentLoaded', () => {
  localStorage.setItem('unreadCount', 0)
  chrome.browserAction.setBadgeText({text: ''})

  chrome.storage.local.get(['info', 'chatMessages', 'organization', 'users'], ({info, chatMessages, organization: organization1, users}) => {
    organization = organization1

    document.querySelector('body').innerHTML = a({href: `https://${organization}.ryver.com/index.html`})
      + usersView(users)
      + chatMessagesView(chatMessages, info)

    document.querySelectorAll('a').forEach(anchor => {
      anchor.onclick = e => {
        chrome.tabs.create({url: e.target.href})
        return false
      }
    })
  })
})

function usersView(users) {
  return div({class: 'users'},
    Object.values(users)
      .sort(orderBy(user => user.received))
      .map(userView))
}

function userView({descriptor, from: {entityType, id}, presence, received}) {
  const url = `https://${organization}.ryver.com/index.html#${entityType}/${id}`
  return a({
    class: presence,
    href: url,
    title: dateToString(new Date(received))
  }, descriptor)
}

function chatMessagesView(chatMessages, info) {
  const {findEntities} = ryverLibrary(info)

  return div(chatMessages
    .filter(message => ['chat', 'chat_deleted', 'chat_updated', 'user_typing'].includes(message.data.type))
    .sort(orderByDesc(message => message.time))
    .map(messageView))

  function messageView(message) {
    const {data, time} = message
    const when = new Date(time)
    const [from, to] = findEntities(data.from, data.to)
    switch (data.type) {
      case 'chat':
        return chatView(when, data, from, to)
      case 'chat_deleted':
        return chatDeletedView(when, data, from, to)
      case 'chat_updated':
        return chatUpdatedView(when, data, from, to)
      case 'user_typing':
        return userTypingView(when, data, from, to)
    }
  }
}

function chatView(when, {text}, from, to) {
  return div({class: 'message'}, [
    headerView(when, from, to),
    div({class: 'body'}, text)
  ])
}

function chatDeletedView(when, {key, text}, from, to) {
  return div({class: 'message', title: key}, [
    headerView(when, from, to),
    div({class: 'body'}, [
      span({class: 'deleted'}, 'DELETED'),
      span(text)
    ])
  ])
}

function chatUpdatedView(when, {key, text}, from, to) {
  return div({class: 'message', title: key}, [
    headerView(when, from, to),
    div({class: 'body'}, [
      span({class: 'updated'}, 'UPDATED'),
      span(text)
    ])
  ])
}

function userTypingView(when, {key, text}, from, to) {
  return div({class: 'message', title: key}, [
    headerView(when, from, to),
    div({class: 'body'}, [
      span({class: 'user-typing'}, 'user typing'),
      span(text)
    ])
  ])
}

function headerView(when, from, to) {
  return div({class: 'header'}, [
    fromView(from),
    separatorView(),
    toView(to),
    timeView(when)
  ])
}

function separatorView() {
  return span({class: 'separator'}, '&#x2794;')
}

function timeView(when) {
  return span({class: 'time'}, dateToString(when))
}

function fromView(from) {
  return entityView('from', from)
}

function toView(to) {
  return entityView('to', to)
}

function entityView(role, {descriptor, entityType, id}) {
  const url = `https://${organization}.ryver.com/index.html#${entityType}/${id}`
  return a({class: role, href: url}, descriptor)
}
