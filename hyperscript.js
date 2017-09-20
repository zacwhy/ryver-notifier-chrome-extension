function hyperscriptHelpers(h) {
  const tagNames = [
    'a',
    'button',
    'div',
    'form',
    'h1',
    'input',
    'label',
    'span'
  ]
  const createHelper = tagName => (first, second) => h(tagName, first, second)
  return tagNames.reduce((acc, tagName) => ({
    ...acc,
    [tagName]: createHelper(tagName)
  }), {})
}

function h(tagName, first, second) {
  const hasProps = typeof first === 'object' && !Array.isArray(first)
  const props = hasProps ? first : {}
  const children = hasProps ? second : first
  const content1 = Array.isArray(children) ? children.join('') : children
  const content = content1 ? content1.replace('\n', '<br />') : ''

  if (props.style && typeof props.style === 'object') {
    props.style = Object.entries(props.style).map(([key, value]) => `${key}: ${value};`).join(' ')
  }

  const propsString = hasProps ? ' ' + Object.entries(props).map(([key, value]) => `${key}="${value}"`).join(' ') : ''
  return `<${tagName}${(propsString)}>${content}</${tagName}>`
}
