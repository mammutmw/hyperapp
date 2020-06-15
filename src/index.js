export default async (state, actions, view, container) => {
  const map = [].map
  const lifecycle = []
  let skipRender
  let isRecycling = true

  const recycleElement = (element) => {
    return {
      nodeName: element.nodeName.toLowerCase(),
      attributes: {},
      children: map.call(element.childNodes, (element) => {
        return element.nodeType === 3 // Node.TEXT_NODE
          ? element.nodeValue
          : recycleElement(element)
      })
    }
  }

  const resolveNode = (node) => {
    return typeof node === 'function'
      ? resolveNode(node(globalState, wiredActions))
      : node != null
        ? node
        : ''
  }

  const render = () => {
    try {
      skipRender = !skipRender

      const node = resolveNode(view)

      if (container && !skipRender) {
        rootElement = patch(container, rootElement, oldNode, (oldNode = node))
      }

      isRecycling = false

      while (lifecycle.length) lifecycle.pop()()
    } catch (error) {
      if (wiredActions.errorHandler) {
        wiredActions.errorHandler({ error, functionName: 'render' })
      }
      throw error
    }
  }

  const scheduleRender = () => {
    if (!skipRender) {
      skipRender = true
      setTimeout(render)
    }
  }

  const clone = (target, source) => {
    const out = {}

    for (const t in target) out[t] = target[t]
    for (const s in source) out[s] = source[s]

    return out
  }

  const setPartialState = (path, value, source) => {
    const target = {}
    if (path.length) {
      target[path[0]] =
        path.length > 1
          ? setPartialState(path.slice(1), value, source[path[0]])
          : value
      return clone(source, target)
    }
    return value
  }

  const getPartialState = (path, source) => {
    let i = 0
    while (i < path.length) {
      source = source[path[i++]]
    }
    return source
  }

  const wireStateToActions = (path, state, actions) => {
    for (const key in actions) {
      typeof actions[key] === 'function'
        ? (function (key, action) {
          actions[key] = async function (data) {
            try {
              let result
              if (action.constructor.name === 'AsyncFunction') {
                result = await action(data)
              } else {
                result = action(data)
              }

              if (typeof result === 'function' && result.constructor.name === 'AsyncFunction') {
                result = await result(getPartialState(path, globalState), actions)
              } else if (typeof result === 'function') {
                result = result(getPartialState(path, globalState), actions)
              }

              if (
                result &&
                result !== (state = getPartialState(path, globalState))
              ) {
                scheduleRender(
                  (globalState = setPartialState(
                    path,
                    clone(state, result),
                    globalState
                  ))
                )
              }
              return result
            } catch (error) {
              if (wiredActions.errorHandler) {
                wiredActions.errorHandler({ error, functionName: key })
              }
              throw error
            }
          }
        })(key, actions[key])
        : wireStateToActions(
          path.concat(key),
          (state[key] = clone(state[key])),
          (actions[key] = clone(actions[key]))
        )
    }

    return actions
  }

  const getKey = (node) => {
    return node ? node.key : null
  }

  const eventListener = (event) => {
    return event.currentTarget.events[event.type](event)
  }

  const updateAttribute = (element, name, value, oldValue, isSvg) => {
    if (name === 'key') {
    } else if (name === 'style') {
      if (typeof value === 'string') {
        element.style.cssText = value
      } else {
        if (typeof oldValue === 'string') oldValue = element.style.cssText = ''
        for (const i in clone(oldValue, value)) {
          const style = value == null || value[i] == null ? '' : value[i]
          if (i[0] === '-') {
            element.style.setProperty(i, style)
          } else {
            element.style[i] = style
          }
        }
      }
    } else {
      if (name[0] === 'o' && name[1] === 'n') {
        name = name.slice(2)

        if (element.events) {
          if (!oldValue) oldValue = element.events[name]
        } else {
          element.events = {}
        }

        element.events[name] = value

        if (value) {
          if (!oldValue) {
            element.addEventListener(name, eventListener)
          }
        } else {
          element.removeEventListener(name, eventListener)
        }
      } else if (
        name in element &&
        name !== 'list' &&
        name !== 'type' &&
        name !== 'draggable' &&
        name !== 'spellcheck' &&
        name !== 'translate' &&
        !isSvg
      ) {
        element[name] = value == null ? '' : value
      } else if (value != null && value !== false) {
        element.setAttribute(name, value)
      }

      if (value == null || value === false) {
        element.removeAttribute(name)
      }
    }
  }

  const createElement = (node, svg) => {
    let element
    let isSvg = false
    if (typeof node === 'string' || typeof node === 'number') {
      element = document.createTextNode(node)
    } else if (svg || node.nodeName === 'svg') {
      element = document.createElementNS('http://www.w3.org/2000/svg', node.nodeName)
      isSvg = true
    } else {
      element = document.createElement(node.nodeName)
    }

    const attributes = node.attributes
    if (attributes) {
      if (attributes.oncreate) {
        lifecycle.push(function () {
          attributes.oncreate(element)
        })
      }

      for (let i = 0; i < node.children.length; i++) {
        element.appendChild(
          createElement(
            (node.children[i] = resolveNode(node.children[i])),
            isSvg
          )
        )
      }

      for (const name in attributes) {
        updateAttribute(element, name, attributes[name], null, isSvg)
      }
    }

    return element
  }

  const updateElement = (element, oldAttributes, attributes, isSvg) => {
    for (const name in clone(oldAttributes, attributes)) {
      if (
        attributes[name] !==
        (name === 'value' || name === 'checked'
          ? element[name]
          : oldAttributes[name])
      ) {
        updateAttribute(
          element,
          name,
          attributes[name],
          oldAttributes[name],
          isSvg
        )
      }
    }

    const cb = isRecycling ? attributes.oncreate : attributes.onupdate
    if (cb) {
      lifecycle.push(function () {
        cb(element, oldAttributes)
      })
    }
  }

  const removeChildren = (element, node) => {
    const attributes = node.attributes
    if (attributes) {
      for (let i = 0; i < node.children.length; i++) {
        removeChildren(element.childNodes[i], node.children[i])
      }

      if (attributes.ondestroy) {
        attributes.ondestroy(element)
      }
    }
    return element
  }

  const removeElement = (parent, element, node) => {
    const done = () => {
      parent.removeChild(removeChildren(element, node))
    }

    const cb = node.attributes && node.attributes.onremove
    if (cb) {
      cb(element, done)
    } else {
      done()
    }
  }

  const patch = (parent, element, oldNode, node, isSvg) => {
    if (node === oldNode) {
    } else if (oldNode == null || oldNode.nodeName !== node.nodeName) {
      const newElement = createElement(node, isSvg)
      parent.insertBefore(newElement, element)

      if (oldNode != null) {
        removeElement(parent, element, oldNode)
      }

      element = newElement
    } else if (oldNode.nodeName == null) {
      element.nodeValue = node
    } else {
      updateElement(
        element,
        oldNode.attributes,
        node.attributes,
        (isSvg = isSvg || node.nodeName === 'svg')
      )

      const oldKeyed = {}
      const newKeyed = {}
      const oldElements = []
      const oldChildren = oldNode.children
      const children = node.children

      for (let i = 0; i < oldChildren.length; i++) {
        oldElements[i] = element.childNodes[i]

        const oldKey = getKey(oldChildren[i])
        if (oldKey != null) {
          oldKeyed[oldKey] = [oldElements[i], oldChildren[i]]
        }
      }

      let i = 0
      let k = 0

      while (k < children.length) {
        const oldKey = getKey(oldChildren[i])
        const newKey = getKey((children[k] = resolveNode(children[k])))

        if (newKeyed[oldKey]) {
          i++
          continue
        }

        if (newKey != null && newKey === getKey(oldChildren[i + 1])) {
          if (oldKey == null) {
            removeElement(element, oldElements[i], oldChildren[i])
          }
          i++
          continue
        }

        if (newKey == null || isRecycling) {
          if (oldKey == null) {
            patch(element, oldElements[i], oldChildren[i], children[k], isSvg)
            k++
          }
          i++
        } else {
          const keyedNode = oldKeyed[newKey] || []

          if (oldKey === newKey) {
            patch(element, keyedNode[0], keyedNode[1], children[k], isSvg)
            i++
          } else if (keyedNode[0]) {
            patch(
              element,
              element.insertBefore(keyedNode[0], oldElements[i]),
              keyedNode[1],
              children[k],
              isSvg
            )
          } else {
            patch(element, oldElements[i], null, children[k], isSvg)
          }

          newKeyed[newKey] = children[k]
          k++
        }
      }

      while (i < oldChildren.length) {
        if (getKey(oldChildren[i]) == null) {
          removeElement(element, oldElements[i], oldChildren[i])
        }
        i++
      }

      for (const i in oldKeyed) {
        if (!newKeyed[i]) {
          removeElement(element, oldKeyed[i][0], oldKeyed[i][1])
        }
      }
    }
    return element
  }

  let rootElement = (container && container.children[0]) || null
  let oldNode = rootElement && recycleElement(rootElement)
  let globalState = clone(state)
  const wiredActions = await wireStateToActions([], globalState, clone(actions))

  scheduleRender()

  return wiredActions
}
