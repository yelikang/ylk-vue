/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    // 这个dep会在defineReactive的
    this.dep = new Dep()
    this.vmCount = 0
    // 通过def方法，不传入enumerable，在循环属性进行双向绑定时会不去枚举__ob__属性
    // 每个响应式对象都有一个__ob__对象，指向Observer；只有对象类型才会定义？？？
    def(value, '__ob__', this)
    // 判断对象是否是数组
    if (Array.isArray(value)) {
      if (hasProto) {
        // 支持原型链
        // 重写数组的push、pop、shift、unshift、splice、sort、reverse方法
        //  function protoAugment (target, src: Object) { target.__proto__ = src } 原型链指向src;
        // arrayMethods重写了上面的方法
        protoAugment(value, arrayMethods)
      } else {
        // 不支持原型链，方法拷贝
        copyAugment(value, arrayMethods, arrayKeys)
      }
      // 对对象中的每个值都进行observe
      this.observeArray(value)
    } else {
      // 普通对象
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    // 对对象中的每个值都进行observe
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 只有value值为对象类型才会有observe过程，才会有__ob__对象
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  // 有__ob__属性时(在Observer实例化时定义的)，表名对象已经被侦测过，直接返回__ob__
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    // 这里的Object.isExtensible会判断对象是否可以扩展，
    // 如果对象Object.freeze之后，对象就不可以扩展，也就不会new Observer进行双向绑定
    // 这里返回Observer的同时，会给value对象原型上增加__ob__对象( def(value, '__ob__', this) )，代表已经是响应对象；避免重复侦测
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

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
  // 拿到属性的Descriptor定义，如果不可configurable，就不进行双向绑定
  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  // 如果预先定义了getter、setter;在实际调用的属性的时候回先调用getter.call
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }
  // 递归子属性进行数据绑定
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      // 访问属性时，开始依赖搜集

      // 这里的Dep.target是在每个组件mountComponent时创建一个以Watcher对象，Watcher调用它的get方法时将Watcher对象pushTarget，
      // 所以Dep.target实际上是当前属性所在组件的Watcher对象(一个组件对应一个Watcher)
      // 组件先进行mounteComponent，然后创建Watcher，Watcher执行updateComponent回调，先执行_render创建虚拟dom、再执行_update 将虚拟dom渲染真实dom
      // 在_render时会调用属性，从而调用这里的响应式getter函数reactiveGetter
      // Observer观察者(被观察对象)， Watcher订阅者(观察者ob发生变化会通知所有watcher去更新组件)
      if (Dep.target) {
        dep.depend()
        if (childOb) {
          // 子属性的Ob观察者，记录父组件的Watcher订阅者 ??? 否

          // 这里的childOb实际上是对value值的观察者，但只有value是对象才会有childOb；
          // 并且与这里每个属性new 出来的dep(用于set时赋值更新)收集统一同样的watcher，实际上就是 value.__ob__.dep.depend (用于一些对象push、$set、$delete等api层面的手动更新)
          // 以便后续操作某个data中的对象(例如对象是个数组[1,2,3]，或者是个对象{name:'',age})
          // 对其中的数组进行push、对对象进行属性的$set/$delete时，能够拿到__ob__对象进行视图更新；直接进行赋值更新会调用这里的set去notify

          // 这的Dep.target实际上还是父级同一个Watcher ???
          // 主要用于Vue.set给对象添加新的属性时能够通知渲染watcher去更新
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
      // 设置属性时进行派发更新
      // 这里的observe(newVal)当属性(对象)，的值发生改变时，可能新增了某些属性；所以需要重新observe
      // shallow浅层的(为true就只监听浅层数据)
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  if (!ob) {
    target[key] = val
    return val
  }
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
