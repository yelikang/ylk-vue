/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

/**
 * Flush both queues and run the watchers.
 * 遍历队列
 */
function flushSchedulerQueue () {
  flushing = true
  let watcher, id

  // watcher从小到大执行原因
  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  //    组件的更新是从父到子的，因为父组件总是在子组件之前创建

  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  //    user wathcers(用户给组件定义watch属性)在render watcher之前 === initWatch创建user watcher，在mountComponent 创建 render watcher之前

  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  //     组件的销毁是在父组件的watcher回调中先执行时，子组件的销毁过程就可以跳过;

  // id从小到大排序，id小的排在前面(父组件在前)
  queue.sort((a, b) => a.id - b.id)

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  // 这里没有缓存queue的长度，是实时计算的；因为在我们执行的过程中可能会有更多的watcher会push进来
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) {
      // 执行beforeUpdate钩子函数(父组件先执行)
      watcher.before()
    }
    id = watcher.id
    // 移除
    has[id] = null
    watcher.run()
    // in dev build, check and stop circular updates.
    // 无限循环的判断(例如在watch属性中重新赋值某个属性，无限循环更新)
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()

  resetSchedulerState()

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue)
  // // 执行updated钩子函数
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks (queue) {
  let i = queue.length
  // 倒序执行组件的updated钩子
  // (所以组件更新: 父beforeUpdate -> 子beforeUpdate -> 孙beforeUpdate -> 孙updated -> 子updated -> 父updated)
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  // 组件同一个方法内有多个属性变更,会多次执行queueWatcher方法
  // 这里根据id判断是否存在，保证同一个Watcher只会被push一次
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      // 如果组件正在flushing，而当前又有新的组件queueWatcher新的watcher进来，
      // 就依次向前找比当前watcher的id小的(id大于就一直往前)，然后插入
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) {
      // 每个轮回只执行一次nextTick，flushSchedulerQueue执行完之后，调用resetSchedulerState恢复waiting为false
      waiting = true

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      nextTick(flushSchedulerQueue)
    }
  }
}
