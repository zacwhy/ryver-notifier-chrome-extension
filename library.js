function dateToString(date) {
  return date.toLocaleString('en-SG', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric'
  })
}

function orderBy(selector, ascending = true) {
  return (a, b) => selector(ascending ? a : b).localeCompare(selector(ascending ? b : a))
}

function orderByDesc(selector) {
  return orderBy(selector, false)
}

function ryverLibrary(info) {
  return {findEntity, findEntities}

  function findEntities(...jids) {
    return jids.map(findEntity)
  }

  function findEntity(jid) {
    const predicate = entity => entity.jid === jid

    const user = info.users.find(predicate)
    if (user) {
      return {...user, entityType: 'users'}
    }

    const team = info.teams.find(predicate)
    if (team) {
      return {...team, entityType: 'teams'}
    }

    const forum = info.forums.find(predicate)
    if (forum) {
      return {...forum, entityType: 'forums'}
    }

    return null
  }
}
