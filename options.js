const {button, form, input, label} = hyperscriptHelpers(h)

document.addEventListener('DOMContentLoaded', restoreOptions)

function restoreOptions() {
  chrome.storage.local.get('organization', ({organization}) => {
    const mountNode = document.querySelector('body')
    mountNode.innerHTML = optionsView(organization)

    const saveButton = document.querySelector('#save')
    saveButton.onclick = e => {
      saveOptions()
      e.preventDefault()
    }
  })
}

function saveOptions() {
  const inputOrganization = document.querySelector('#organization')
  const organization = inputOrganization.value

  if (organization) {
    chrome.storage.local.set({organization})
  } else {
    chrome.storage.local.remove('organization')
  }
  console.log('saved', organization)
}

function optionsView(organization = '') {
  return form([
    label({for: 'organization'}, 'Organization'),
    input({id: 'organization', value: organization}),
    button({id: 'save'}, 'Save')
  ])
}
