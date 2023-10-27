/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    // 判断是否渲染watcher(watcher分为渲染 render watcher、user watcher、computed watcher
    // render watcher 在mountComponent时出创建，主要用来更新组件视图
    // user watcher   用户在组件中自定义的watch属性，在initState初始化组件数据时，调用initWatch中的createWatcher、调用vm.$watcher创建user watcher
    // computed watcher 用户在组建中定义的computed属性，lazy为true代表的是computed watcher
    if (isRenderWatcher) {
      // 下划线watcher代表是渲染watcher(页面渲染内容，另外还有计算watcher等($watch))
      vm._watcher = this
    }
    // 可以通过vm._watchers看到组件实例vm中关联了哪些watcher 以及他们的表达式 expression
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      // user watcher中的expOrFn为string，通过expOrFn装换获取getter函数
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // computed属性创建的watcher这里的lazy会为true，不会直接求值；只有真实调用计算属性时才会调用
    this.value = this.lazy
      ? undefined
      : this.get()
  }

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
        // deep属性，在组件watch属性中定义某个属性的深层监听(user watcher)
        // 递归对象的所有深层属性，调用属性收集监听；当深层属性改变时也会进行回调
        traverse(value)
      }
      popTarget()
      // 这里每次调用完组件的updateComponent之后，清理一下Deps；
      // 理论上addDep过程会判断Dep的id是否重复，所以无需清理
      // 但是考虑到A、B两个组件切换的场景:
      // 首先渲染A组件，对A组件中的数据添加getter
      // 通过条件渲染了B组件，对B组件的数据添加getter
      // 这时候我们修改A组件的组局，如果没有移除依赖的过程；就会通知A组件中的所有订阅者进行回调。但其实A组件没有渲染，造成浪费
      // 因此 Vue 设计了在每次添加完新的订阅，会移除掉旧的订阅，这样就保证了在我们刚才的场景中，
      // 如果渲染 b 模板的时候去修改 a 模板的数据，a 数据订阅回调已经被移除了，所以不会有任何浪费
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    // 记录watcher(一个component对应一个watcher)中依赖哪些属性/变量
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        // dep中记录属性会影响哪些组件变更，当属性更新时会调用Dep的notify方法通知watcher更新
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    // 第一次来时deps为空数组，不会执行
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      // 旧的deps中有的Watcher,在新的newDepIds中没有，就移除订阅者
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    // depIds与newDepIds进行交换，depIds用来保留旧的Dep的id
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    // deps 与 newDeps进行交换，deps用来保留旧的Dep
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    // newDepIds、newDeps每次渲染完都会情况，在执行_render时，从新收集新的Dep；并与旧的Dep进行对比，从旧的中移除没有使用的Dep
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      // computed watcher 计算wathcer的更新只是将dirty设置为true,页面调用计算属性时再执行evaluate获取真的值
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
        // 判断是不是用户watcher(通过watch属性创建的watcher)
        if (this.user) {
          try {
            // 执行 watch属性定义的回调函数，传入newVal、oldVal
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

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  // 专门为lazy watchers(computed watcher)
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    // 卸载watcher
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
