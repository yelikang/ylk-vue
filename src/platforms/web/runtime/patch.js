/* @flow */

// 真实dom操作的相关方法
import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
// 特定平台(例如web),属性、类等的钩子函数
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)

// 这里用到了函数柯里化的概念(将接收多个参数的函数，变换成接受单一参数的函数)，
// 例如这里如果不通过这种方式，按正常的逻辑，每个调用patch方法的地方都要手动传入nodeOps、modules、其它业务参数
// 而这里柯里化之后(实际就是闭包的技巧)，就不用每次都传入相同的参数(或者是与weex差异化的参数)
export const patch: Function = createPatchFunction({ nodeOps, modules })
