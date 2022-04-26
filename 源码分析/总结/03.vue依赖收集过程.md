### vue对依赖进行收集的过程
* 组件在进行mountComponents时，会通过创建Watcher对象去执行updateComponent方法、_render方法、_update方法；在_render方法时会调用每个组件的render方法(要么通过vue-loader编译、要么通过vue源码实时compiler成对应的render方法)
* 执行render方法时会如果读取data中的某个属性(例如this.msg)，会调用proxy代理中的sharedPropertyDefinition.get方法(该方法主要代理this._data.msg与this.msg之间的关系)
* 调用proxy中的sharedPropertyDefinition.get方法就会执行defineReactive中对data属性劫持的get方法(sharedPropertyDefinition.get虽然读取的是vm._data属性，但是defineReactive中的data与vm.data指向的是同一个对象)，从而进行依赖收集(这里收集的是watcher=>watcher在执行updateComponent之前会pushTarget，通过updateComponent逐步调用到组件的render方法，render中读取属性的get，get中就会收集每个Watcher)

```Watcher调用getter方法，实际调用的是updateComponent；这里的pushTarget会向依赖收集器Dep的target对象传递一个Watcher，updateComponent调用到组件的render方法时，读取data的某个属性，会进行Dep.target的依赖收集```
```js
/**
   * Evaluate the getter, and re-collect dependencies.
   */
  get () {
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value)
      }
      popTarget()
      this.cleanupDeps()
    }
    return value
  }
```
```给Dep.target赋值一个Watcher对象```
```js
Dep.target = null
const targetStack = []

export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}

export function popTarget () {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
```

```Watcher调用get方法(实际是updateComponent方法)，逐步执行_render、_update；组件render函数调用时，读取data的某个属性，执行到对象的Object.defineProperty的get劫持方法，然后进行dep.depend依赖收集，即上面定义的Dep.target引用的Watcher对象```
```js
/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        dep.depend()
        if (childOb) {
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
  })
}
```

```当data属性变动时，会调用Object.defineProperty的set方法，set方法通过依赖收集器Dep的notify方法，去调用每个Watcher中的update方法、从而调用getter方法，再次执行updateComponent回调方法、执行_render、执行_update进行页面渲染更新 ```

Dep的notify方法
```js
notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
```

Watcher中的update、run方法
```js
/**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      const value = this.get()
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }
```