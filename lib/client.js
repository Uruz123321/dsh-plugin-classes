/**
 * Plugin classes for DeepSeek Harness — browser half.
 *
 * Three surfaces over one store:
 *   - a composer chip left of the model selector: the current session's class
 *     set, with a checkbox per class to add/remove it live (blank sessions
 *     rebind immediately; a started session gets a one-turn temporary session,
 *     because DSH locks a composition after its first turn);
 *   - a `插件管理` sidebar panel for creating/renaming/deleting classes and
 *     adding or removing the plugins inside them;
 *   - an assign dialog that appears when a newly downloaded plugin has not been
 *     filed into any class yet.
 *
 * The host class is implicit and hidden: it holds the baseline every session
 * composes, so it is never listed and never deletable.
 *
 * Hand-authored module-factory bundle: the host serves it verbatim, so it uses
 * only platform seed modules and talks to DSH through Cordis services.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-classes',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useSyncExternalStore } = React

    /** Plugin entry id: the profile row this bundle's host half is mounted as. */
    const ENTRY_ID = 'dsh-plugin-classes'
    /** Sidebar panel id; also the `main` slot key. */
    const PANEL_ID = 'plugin-classes'
    /** Prefix every class preset id carries (kept in sync with the host half). */
    const PRESET_PREFIX = 'cls-'
    /** The implicit global class: baseline composition, never listed. */
    const HOST_CLASS_ID = 'host'
    /** Preset id of the bare host baseline. */
    const HOST_PRESET_ID = PRESET_PREFIX + HOST_CLASS_ID
    /** Locale dictionary namespace. */
    const NS = 'pluginClasses'

    // ─── dictionaries ───────────────────────────────────────────────────────
    const zh = {
      'panel.label': '插件管理',
      'chip.aria': '插件类',
      'chip.hostOnly': '仅宿主基线',
      'chip.locked': '会话已开始：勾选新类会开启“仅本轮”的临时会话。',
      'menu.title': '插件类（可多选）',
      'menu.hint': '勾选即加入本会话。宿主基线始终生效，类只做增删。',
      'menu.empty': '还没有插件类。先在「插件管理」里新建一个。',
      'menu.manage': '管理插件类…',
      'menu.loading': '正在读取插件类…',
      'menu.error': '读取插件类失败',
      'menu.retry': '重试',
      'menu.lockedOff': '会话已开始：已选的类不能取消（组合已锁定）。',
      'menu.oneTurn': '会话已开始，勾选的类只在“本轮临时会话”里生效，回答完自动归档。',
      'menu.tempOn': '本轮临时会话：',
      'menu.endTemp': '结束本轮临时会话',
      'panel.title': '插件管理',
      'panel.subtitle': '宿主基线对所有会话生效；插件类在它之上增删插件，一个会话可以同时勾选多个类。',
      'panel.new': '新建插件类',
      'panel.back': '返回对话',
      'panel.empty': '还没有插件类。',
      'panel.pick': '从左侧选择一个插件类，或新建一个。',
      'panel.name': '名称',
      'panel.description': '说明',
      'panel.hostNote': '宿主基线（全局、不可删除、不在列表中显示）',
      'panel.delete': '删除',
      'panel.deleteConfirm': '确认删除',
      'panel.cancel': '取消',
      'panel.deleted': '已删除（只是隐藏：旧会话仍能加载它）',
      'panel.deleteHint': '删除不会破坏已有会话：类只被隐藏，不再出现在选择列表里。',
      'panel.deleteRestart': '删除要等新版本加载（重启应用一次）后才能用。',
      'panel.saved': '已保存',
      'panel.saving': '保存中…',
      'panel.classId': '标识',
      'panel.health': '加载状态',
      'panel.health.ok': '可加载',
      'panel.health.broken': '无法加载',
      'panel.rows': '类内插件（宿主基线 + 本类增减）',
      'panel.rowsHint': '取消勾选即从该类中移除该行，勾选恢复。',
      'panel.added': '本类额外加入的插件',
      'panel.addedEmpty': '没有额外插件。',
      'panel.add': '可加入的插件',
      'panel.addHint': '已安装但还没归入任何类：点「加入」把它放进当前类。',
      'panel.addEmpty': '没有可加入的插件。',
      'panel.addOne': '加入',
      'panel.removeOne': '移出',
      'panel.host': '宿主级插件（所有会话可见，不能加入类）',
      'panel.hostHint': '它们由 profile 直接加载；新下载的插件请在归类对话框里选择类，会自动从宿主层停用。',
      'panel.sessions': '使用当前插件类的会话',
      'panel.sessionsEmpty': '暂无会话使用这个类。',
      'panel.sessionsBlank': '新会话',
      'panel.includes': '包含的插件类',
      'panel.includesHint': '勾上后，本类会先叠加这些类的增删，再应用自己的增删——选中本类就等于同时选中它们。',
      'panel.includesEmpty': '没有可包含的类（会造成循环的类已被排除）。',
      'note.add': '＋ 添加注释',
      'note.edit': '编辑注释',
      'note.placeholder': '简要说明这个插件做什么…',
      'panel.manual': '按包名添加',
      'panel.manualPlaceholder': '例如 dsh-posterflow-ai',
      'panel.pending': '待归类插件',
      'panel.pendingHint': '这些插件已下载但还没选择归属的类。',
      'panel.pendingOpen': '现在归类',
      'panel.err.load': '读取失败',
      'panel.err.save': '保存失败',
      'panel.err.name': '名称不能为空',
      'panel.err.dup': '同名插件类已存在',
      'assign.title': '新插件归类',
      'assign.subtitle': '选择这个插件进入哪些插件类（可多选）。',
      'assign.classes': '加入这些类',
      'assign.disableHost': '同时从宿主层停用（推荐：这样只有勾选的类能看到它）',
      'assign.later': '暂不加入',
      'assign.confirm': '确定',
      'assign.working': '正在处理…',
      'assign.error': '归类失败',
      'assign.empty': '还没有插件类，先建一个再来归类。',
    }
    const en = {
      'panel.label': 'Plugin classes',
      'chip.aria': 'Plugin classes',
      'chip.hostOnly': 'Host baseline only',
      'chip.locked': 'Session started: ticking a new class opens a one-turn temporary session.',
      'menu.title': 'Plugin classes (multi-select)',
      'menu.hint': 'Ticking a class adds it to this session. The host baseline is always active; classes only add or remove rows.',
      'menu.empty': 'No plugin classes yet. Create one in Plugin classes first.',
      'menu.manage': 'Manage plugin classes…',
      'menu.loading': 'Reading plugin classes…',
      'menu.error': 'Could not read plugin classes',
      'menu.retry': 'Retry',
      'menu.lockedOff': 'Session started: already selected classes cannot be removed (composition locked).',
      'menu.oneTurn': 'The session already started, so a ticked class applies to a one-turn temporary session which is archived afterwards.',
      'menu.tempOn': 'One-turn session: ',
      'menu.endTemp': 'End this one-turn session',
      'panel.title': 'Plugin classes',
      'panel.subtitle': 'The host baseline applies to every session; classes add or remove plugins on top of it, and one session may tick several classes.',
      'panel.new': 'New plugin class',
      'panel.back': 'Back to chat',
      'panel.empty': 'No plugin classes yet.',
      'panel.pick': 'Pick a plugin class on the left, or create one.',
      'panel.name': 'Name',
      'panel.description': 'Description',
      'panel.hostNote': 'Host baseline (global, undeletable, not listed)',
      'panel.delete': 'Delete',
      'panel.deleteConfirm': 'Confirm delete',
      'panel.cancel': 'Cancel',
      'panel.deleted': 'Deleted (hidden: existing sessions can still load it)',
      'panel.deleteHint': 'Deleting never breaks a session: the class is only hidden and stops being offered.',
      'panel.deleteRestart': 'Deleting needs the new version to load first (restart the app once).',
      'panel.saved': 'Saved',
      'panel.saving': 'Saving…',
      'panel.classId': 'Identity',
      'panel.health': 'Load state',
      'panel.health.ok': 'Loadable',
      'panel.health.broken': 'Cannot load',
      'panel.rows': 'Plugins inside this class (host baseline + this class)',
      'panel.rowsHint': 'Uncheck to remove that row for this class; check to restore it.',
      'panel.added': 'Plugins this class adds',
      'panel.addedEmpty': 'No extra plugins.',
      'panel.add': 'Available plugins',
      'panel.addHint': 'Installed but not filed into any class yet: press Add to put it in the current class.',
      'panel.addEmpty': 'Nothing to add.',
      'panel.addOne': 'Add',
      'panel.removeOne': 'Remove',
      'panel.host': 'Host-level plugins (visible to every session, cannot join a class)',
      'panel.hostHint': 'The profile mounts these directly; a newly downloaded plugin is filed through the assign dialog, which disables its host-level row.',
      'panel.sessions': 'Sessions using this plugin class',
      'panel.sessionsEmpty': 'No session uses this class yet.',
      'panel.sessionsBlank': 'new',
      'panel.includes': 'Plugin classes this class includes',
      'panel.includesHint': 'A ticked class is composed before this one, so selecting this class also selects them — no need to list their plugins again.',
      'panel.includesEmpty': 'Nothing to include (classes that would close a cycle are hidden).',
      'note.add': '＋ Add a note',
      'note.edit': 'Edit note',
      'note.placeholder': 'A line about what this plugin does…',
      'panel.manual': 'Add by package name',
      'panel.manualPlaceholder': 'e.g. dsh-posterflow-ai',
      'panel.pending': 'Unfiled plugins',
      'panel.pendingHint': 'Downloaded but not yet assigned to any class.',
      'panel.pendingOpen': 'File now',
      'panel.err.load': 'Could not read',
      'panel.err.save': 'Could not save',
      'panel.err.name': 'A name is required',
      'panel.err.dup': 'Another class already uses that name',
      'assign.title': 'File the new plugin',
      'assign.subtitle': 'Choose which plugin classes this plugin joins (multi-select).',
      'assign.classes': 'Add to these classes',
      'assign.disableHost': 'Also disable it at host level (recommended: only the ticked classes can see it)',
      'assign.later': 'Not now',
      'assign.confirm': 'Confirm',
      'assign.working': 'Working…',
      'assign.error': 'Could not file the plugin',
      'assign.empty': 'No plugin classes yet — create one first.',
    }

    // ─── styles ─────────────────────────────────────────────────────────────
    const CSS = [
      '.dpc-chip{box-sizing:border-box;display:flex;align-items:center;gap:4px;min-width:0;max-width:240px;height:28px;padding:0 4px 0 8px;border:none;border-radius:var(--dsw-radius-sm,8px);outline:none;background:transparent;color:var(--dsw-alias-label-secondary,#5a6478);font-family:inherit;font-size:13px;line-height:20px;font-weight:400;cursor:pointer;transition:background 120ms ease}',
      '.dpc-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.dpc-chip:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#3b6ef0))}',
      '.dpc-chip:disabled{color:var(--dsw-alias-label-dimmed,#9aa3b2);cursor:default}',
      '.dpc-chip-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;color:currentColor}',
      '.dpc-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-chip-count{flex:0 0 auto;color:var(--dsw-alias-label-caption,#8b95a6);font-size:11px}',
      '.dpc-menu{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;width:max-content;min-width:min(300px,calc(100vw - 32px));max-width:min(480px,calc(100vw - 32px));max-height:min(460px,calc(100vh - 96px));overflow:hidden;padding:4px;border:0;border-radius:var(--dsw-radius-lg,16px);isolation:isolate;box-shadow:0 0 0 .5px var(--dsw-alias-border-l1,rgba(0,0,0,.09)),0 3px 8px 0 rgba(0,0,0,.04),0 0 20px 0 rgba(0,0,0,.05);background:var(--dsw-menu-surface-fill,rgba(248,249,250,.72));-webkit-backdrop-filter:blur(40px) saturate(150%);backdrop-filter:blur(40px) saturate(150%);color:var(--dsw-alias-label-primary,#1d2433);font-family:inherit}',
      '@supports (background-color:color-mix(in srgb,red 50%,transparent)){.dpc-menu{background-color:color-mix(in srgb,var(--dsw-alias-bg-overlay,#20242c) 82%,transparent)}}',
      '.dpc-menu-head{padding:5px 7px 2px;color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:16px;font-weight:500}',
      '.dpc-menu-body{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px}',
      '.dpc-item{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:auto;min-width:100%;min-height:34px;padding:5px 7px;border:none;border-radius:12px;outline:none;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
      '.dpc-item:hover:not(:disabled),.dpc-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.dpc-item:disabled{color:var(--dsw-alias-label-dimmed,#9aa3b2);cursor:default}',
      '.dpc-item-copy{display:flex;flex:1;flex-direction:column;min-width:0}',
      '.dpc-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px}',
      '.dpc-item-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:15px}',
      '.dpc-box{box-sizing:border-box;flex:0 0 16px;width:16px;height:16px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.28));border-radius:4px;display:grid;place-items:center;color:#fff;background:transparent}',
      '.dpc-box[data-checked="true"]{border-color:transparent;background:var(--dsw-alias-state-business-primary,#3b6ef0)}',
      '.dpc-badge{flex:0 0 auto;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-tertiary,#78828f);font-size:10px;line-height:15px}',
      '.dpc-note{padding:8px;color:var(--dsw-alias-label-tertiary,#78828f);font-size:12px;line-height:18px}',
      '.dpc-warn{margin:2px 4px 4px;padding:6px 7px;border-radius:10px;background:rgba(214,150,45,.14);color:var(--dsw-alias-state-warn-label,#8a5a00);font-size:11px;line-height:16px}',
      '.dpc-error{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:3px;padding:6px 7px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(214,64,64,.1));color:var(--dsw-alias-state-error-primary,#c22d2d);font-size:11px;line-height:16px}',
      '.dpc-error button{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}',
      '.dpc-menu-foot{display:flex;gap:4px;margin-top:4px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}',
      '.dpc-menu-foot .dpc-item{min-height:30px}',
      '.dpc-empty-state{padding:10px 7px;color:var(--dsw-alias-label-tertiary,#78828f);font-size:12px;line-height:18px}',
      '.dpc-panel{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#1d2433);font-family:inherit}',
      '.dpc-panel-head{display:flex;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}',
      '.dpc-panel-head h1{margin:0;font-size:15px;line-height:22px;font-weight:600}',
      '.dpc-panel-head p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#78828f);font-size:12px;line-height:17px}',
      '.dpc-spacer{flex:1}',
      '.dpc-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:8px;background:transparent;color:inherit;font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dpc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.dpc-btn:disabled{color:var(--dsw-alias-label-dimmed,#9aa3b2);cursor:default}',
      '.dpc-btn.primary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#3b6ef0);color:#fff}',
      '.dpc-btn.danger{color:var(--dsw-alias-state-error-primary,#c22d2d)}',
      '.dpc-panel-body{display:flex;flex:1;min-height:0}',
      '.dpc-rail{box-sizing:border-box;display:flex;flex-direction:column;gap:2px;width:220px;min-width:220px;padding:10px 8px;overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}',
      '.dpc-rail-item{display:flex;flex-direction:column;gap:1px;width:100%;padding:7px 8px;border:none;border-radius:8px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
      '.dpc-rail-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.dpc-rail-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.09))}',
      '.dpc-rail-name{font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-rail-sub{color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-rail-host{padding:7px 8px;color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:15px}',
      '.dpc-detail{flex:1;min-width:0;overflow-y:auto;padding:16px 18px 40px}',
      '.dpc-field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;max-width:620px}',
      '.dpc-field label{color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:16px;font-weight:500}',
      '.dpc-field input{box-sizing:border-box;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:8px;background:transparent;color:inherit;font-family:inherit;font-size:13px;line-height:18px;outline:none}',
      '.dpc-field input:focus{border-color:var(--dsw-alias-state-business-primary,#3b6ef0)}',
      '.dpc-inline{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}',
      '.dpc-section{margin:18px 0 8px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.dpc-section h2{margin:0;font-size:13px;line-height:20px;font-weight:600}',
      '.dpc-section span{color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:16px}',
      '.dpc-list{display:flex;flex-direction:column;gap:1px;max-width:760px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));border-radius:10px;padding:4px;background:transparent}',
      '.dpc-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:30px;padding:3px 6px;border-radius:7px}',
      '.dpc-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05))}',
      '.dpc-row label{display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer;font-size:12px;line-height:18px}',
      '.dpc-row code{flex:0 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-row-id{flex:0 0 auto;margin-left:auto;color:var(--dsw-alias-label-caption,#98a2b1);font-size:10px}',
      '.dpc-note-slot{flex:0 0 100%;min-width:0;margin:1px 0 2px 2px}',
      '.dpc-note-btn{display:block;box-sizing:border-box;max-width:100%;padding:1px 5px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5a6478);font-family:inherit;font-size:11px;line-height:16px;text-align:left;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-note-btn.empty{color:var(--dsw-alias-label-caption,#98a2b1);cursor:pointer}',
      '.dpc-note-btn:hover{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05))}',
      '.dpc-note-input{box-sizing:border-box;width:100%;height:24px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:6px;background:transparent;color:inherit;font-family:inherit;font-size:11px;line-height:16px;outline:none}',
      '.dpc-muted{color:var(--dsw-alias-label-tertiary,#78828f);font-size:12px;line-height:18px;padding:6px}',
      '.dpc-session{display:flex;align-items:center;gap:8px;min-height:28px;padding:3px 6px;border-radius:7px;font-size:12px;line-height:18px}',
      '.dpc-session:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05))}',
      '.dpc-session-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-pill{padding:1px 7px;border-radius:999px;border:1px solid transparent;font-size:11px;line-height:16px;font-weight:500;background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-secondary,#5a6478);white-space:nowrap}',
      '.dpc-pill.ok{color:var(--dsw-alias-state-success-primary,#1f8a4c);border-color:rgba(46,160,90,.35);background:rgba(46,160,90,.14)}',
      '.dpc-pill.bad{color:var(--dsw-alias-state-error-primary,#c22d2d);border-color:rgba(214,64,64,.35);background:rgba(214,64,64,.14)}',
      '.dpc-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1200;padding:8px 14px;border-radius:10px;background:var(--dsw-alias-bg-overlay,#1d2433);color:var(--dsw-alias-label-inverse,#fff);font-size:12px;line-height:18px;box-shadow:0 6px 24px rgba(0,0,0,.18)}',
      '.dpc-overlay{position:fixed;inset:0;z-index:1150;display:grid;place-items:center;background:rgba(10,14,22,.42);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}',
      '.dpc-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 48px));max-height:min(72vh,620px);display:flex;flex-direction:column;overflow:hidden;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#1d2433);box-shadow:0 12px 48px rgba(0,0,0,.28);font-family:inherit}',
      '.dpc-dialog-head{padding:16px 18px 8px}',
      '.dpc-dialog-head h2{margin:0;font-size:15px;line-height:22px;font-weight:600}',
      '.dpc-dialog-head p{margin:3px 0 0;color:var(--dsw-alias-label-tertiary,#78828f);font-size:12px;line-height:17px}',
      '.dpc-dialog-body{flex:1;min-height:0;overflow-y:auto;padding:4px 18px 10px}',
      '.dpc-dialog-foot{display:flex;gap:8px;justify-content:flex-end;padding:10px 18px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07))}',
      '.dpc-dialog-sub{margin:12px 0 4px;color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:16px;font-weight:500}',
      '.dpc-dialog-item{display:flex;align-items:center;gap:8px;padding:6px;border-radius:8px;cursor:pointer;font-size:13px;line-height:18px}',
      '.dpc-dialog-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.dpc-dialog-toggle{display:flex;align-items:center;gap:8px;margin:10px 0 2px;padding:6px;border-radius:8px;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5a6478)}',
      '.dpc-plugin-card{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.07));border-radius:10px;padding:8px 10px;margin-bottom:8px}',
      '.dpc-plugin-name{font-size:13px;line-height:18px;font-weight:600}',
      '.dpc-plugin-desc{margin-top:2px;color:var(--dsw-alias-label-tertiary,#78828f);font-size:11px;line-height:16px}',
    ].join('\n')

    /** Inject the stylesheet once per page; the disposer removes it. */
    function installStyles() {
      const existing = document.querySelector('style[data-dsh-plugin="dsh-plugin-classes"]')
      if (existing !== null) return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-plugin-classes'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => { style.remove() }
    }

    // ─── ids ────────────────────────────────────────────────────────────────
    const safe = value => String(value).replace(/[^A-Za-z0-9._-]/g, '-')

    /** Preset id for one class id. */
    const presetIdOf = classId => PRESET_PREFIX + safe(classId)

    /**
     * Preset id of a class selection: the host baseline alone, or the selected
     * user classes in sorted order (mirrors the host half).
     * @param classIds - selected user-class ids.
     */
    const comboPresetId = (classIds) => {
      const ids = [...new Set((classIds ?? []).map(String))]
        .filter(id => id !== '' && id !== HOST_CLASS_ID)
        .sort()
      if (ids.length === 0) return HOST_PRESET_ID
      return PRESET_PREFIX + ids.map(safe).join('+')
    }

    /** Class ids named by a preset id (empty for the host preset; undefined when foreign). */
    const classIdsOf = (presetId) => {
      const id = String(presetId === undefined || presetId === null ? '' : presetId)
      if (!id.startsWith(PRESET_PREFIX)) return undefined
      const rest = id.slice(PRESET_PREFIX.length)
      if (rest === HOST_CLASS_ID) return []
      if (rest === '') return undefined
      return rest.split('+').filter(part => part !== '')
    }

    const newClassId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    /**
     * Name prefix that marks a soft-deleted class.
     *
     * Deleting must never retire a class's preset id: a session (often a blank
     * one that New Session reuses) may still be bound to it, and a missing
     * preset makes that adoption fail outright. The `hidden` config flag is the
     * clean way to express this, but a freshly installed bundle only gets the
     * host half that declares it after a process restart — so the name marker
     * carries the same meaning through the fields every host version accepts.
     */
    const HIDDEN_PREFIX = '␟已删除 '
    const isHidden = pluginClass => pluginClass !== undefined && pluginClass !== null
      && (pluginClass.hidden === true || String(pluginClass.name || '').startsWith(HIDDEN_PREFIX))

    // ─── icons ──────────────────────────────────────────────────────────────
    const svg = (props, children) => h('svg', {
      viewBox: '0 0 16 16',
      width: props.size,
      height: props.size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    }, children)
    const PlugIcon = (props) => svg({ size: props.size || 14 }, [
      h('path', { key: 'a', d: 'M6 2v3M10 2v3' }),
      h('path', { key: 'b', d: 'M3.5 5h9v2.5a4.5 4.5 0 0 1-9 0V5Z' }),
      h('path', { key: 'c', d: 'M8 12v2' }),
    ])
    const ChevronDown = (props) => svg({ size: props.size || 14 }, [
      h('path', { key: 'p', d: 'M4 6.5 8 10l4-3.5' }),
    ])
    const CheckIcon = (props) => svg({ size: props.size || 14 }, [
      h('path', { key: 'p', d: 'M3 8.5 6.2 11.5 13 4.5' }),
    ])
    const PlusIcon = (props) => svg({ size: props.size || 14 }, [
      h('path', { key: 'p', d: 'M8 3v10M3 8h10' }),
    ])

    /** Last path segment of a module specifier, for a compact label. */
    const shortName = (spec) => {
      const text = String(spec === undefined || spec === null ? '' : spec)
      const parts = text.split('/').filter(Boolean)
      const tail = parts.length === 0 ? text : parts[parts.length - 1]
      return tail === '' ? text : tail
    }

    /** Resolve a manifest `LocalizedText` to a display string. */
    const localized = (text) => {
      if (text === undefined || text === null) return undefined
      if (typeof text === 'string') return text
      return text.zh || text['zh-CN'] || text.en || Object.values(text)[0]
    }
    const bundleTitle = (bundle) => localized(bundle && bundle.meta && bundle.meta.title) || (bundle && bundle.name) || ''

    // ─── store ──────────────────────────────────────────────────────────────
    const INITIAL = {
      status: 'idle',
      error: null,
      loading: false,
      saving: false,
      saveError: null,
      classes: [],
      host: {},
      sessions: {},
      plugins: {},
      notes: {},
      roster: {},
      bundles: [],
      presetRows: {},
      notice: null,
    }

    /** One snapshot store over the plugin-class world, shared by all surfaces. */
    class ClassesStore {
      constructor(ctx) {
        this.ctx = ctx
        this.state = INITIAL
        this.listeners = new Set()
        this.inflight = undefined
        /** Sessions started by the one-turn flow, awaiting archive. */
        this.tempSessions = new Set()
        this.bootstrapped = false
      }

      subscribe = (listener) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      }

      getSnapshot = () => this.state

      /** Replace the snapshot and notify subscribers. */
      set(patch) {
        this.state = Object.assign({}, this.state, patch)
        for (const listener of Array.from(this.listeners)) listener()
      }

      /** Show a transient notice above the composer. */
      flash(text) {
        this.set({ notice: text })
        window.setTimeout(() => {
          if (this.state.notice === text) this.set({ notice: null })
        }, 2600)
      }

      /** Read every source the surfaces render. */
      async load(force) {
        if (this.inflight !== undefined && force !== true) return this.inflight
        this.set({ loading: true })
        const run = this.readAll().catch((error) => {
          this.set({ loading: false, status: 'error', error: String(error && error.message ? error.message : error) })
        })
        this.inflight = run
        try {
          await run
        } finally {
          if (this.inflight === run) this.inflight = undefined
        }
      }

      async readAll() {
        // One unreachable endpoint must not blank the whole surface.
        const settle = async (promise) => {
          try {
            return await promise
          } catch (error) {
            return { ok: false, error: { message: String(error && error.message ? error.message : error) } }
          }
        }
        const results = await Promise.all([
          settle(this.ctx.remote.settings.describe()),
          settle(this.ctx.remote.agentPresets.list()),
          settle(this.ctx.remote.pluginManager.listBundles()),
          settle(this.ctx.remote.pluginInventory.list()),
        ])
        const settingsResult = results[0]
        const rosterResult = results[1]
        const bundlesResult = results[2]
        const inventoryResult = results[3]
        if (!settingsResult.ok) {
          this.set({ loading: false, status: 'error', error: settingsResult.error.message })
          return
        }
        const namespaces = (settingsResult.value && settingsResult.value.namespaces) || []
        let namespace
        for (const candidate of namespaces) {
          if (candidate.ns === ENTRY_ID) { namespace = candidate; break }
        }
        const config = namespace && namespace.value ? namespace.value : {}
        // Whether the *running* host schema already accepts the `hidden` flag
        // (soft delete). A newly installed bundle needs a process restart before
        // the host half exposes it, and hiding without schema support would
        // half-apply a delete, so the panel offers no delete until then.
        const schemaText = JSON.stringify(namespace ? namespace.schema : null)
        const roster = {}
        if (rosterResult.ok) {
          for (const preset of (rosterResult.value && rosterResult.value.presets) || []) roster[preset.id] = preset
        }
        const presetRows = {}
        if (inventoryResult.ok) {
          for (const group of (inventoryResult.value && inventoryResult.value.agentPresets) || []) {
            presetRows[group.id] = group.rows || []
          }
        }
        this.set({
          loading: false,
          status: 'ready',
          error: null,
          classes: Array.isArray(config.classes) ? config.classes : [],
          host: config.host && typeof config.host === 'object' ? config.host : {},
          sessions: config.sessions && typeof config.sessions === 'object' ? config.sessions : {},
          plugins: config.plugins && typeof config.plugins === 'object' ? config.plugins : {},
          notes: config.notes && typeof config.notes === 'object' ? config.notes : {},
          roster,
          presetRows,
          schemaText,
          bundles: bundlesResult.ok && Array.isArray(bundlesResult.value) ? bundlesResult.value : [],
        })
        await this.bootstrapAssignments()
      }

      /** Whether the running host half accepts the soft-delete `hidden` flag. */
      canHide() {
        return String(this.state.schemaText || '').includes('"hidden"')
      }
      /**
       * On the very first run (no assignment record at all), mark every
       * already-installed plugin as "handled with no class", so only plugins
       * downloaded afterwards open the assign dialog. An existing record is
       * never extended here: a name missing from a populated record means a
       * genuinely new download and must be offered to the operator.
       */
      async bootstrapAssignments() {
        if (this.bootstrapped) return
        this.bootstrapped = true
        const known = this.state.plugins || {}
        if (Object.keys(known).length > 0) return
        const installed = this.state.bundles.filter(bundle => bundle.installed === true)
        if (installed.length === 0) return
        const next = Object.assign({}, known)
        for (const bundle of installed) next[bundle.name] = []
        await this.patch({ plugins: next })
      }

      /** Write several state fields at once. */
      async patch(fields) {
        this.set({ saving: true, saveError: null })
        const result = await this.ctx.remote.settings.update(ENTRY_ID, fields, undefined)
        if (!result.ok) {
          this.set({ saving: false, saveError: result.error.message })
          return result.error.message
        }
        this.set({ saving: false })
        await this.load(true)
        return undefined
      }

      /** Installed bundles that no assignment record mentions yet. */
      pendingBundles() {
        const known = this.state.plugins || {}
        return this.state.bundles.filter(bundle => bundle.installed === true && known[bundle.name] === undefined)
      }

      /** One class by id, or undefined. */
      classById(classId) {
        return (this.state.classes || []).find(pluginClass => pluginClass.id === classId)
      }

      /** The editable note attached to a package or row name ('' when none). */
      noteOf(name) {
        const notes = this.state.notes || {}
        const value = notes[name]
        return typeof value === 'string' ? value : ''
      }

      /** Persist one note. An empty string clears it without deleting the key. */
      async saveNote(name, text) {
        if (typeof name !== 'string' || name === '') return undefined
        const notes = Object.assign({}, this.state.notes)
        notes[name] = String(text ?? '')
        return this.patch({ notes })
      }

      /**
       * Class ids a class pulls in, filtered to classes that still exist and to
       * ids that would not close a cycle through that class.
       */
      includeCandidates(classId) {
        const classes = this.state.classes || []
        const byId = new Map(classes.map(pluginClass => [pluginClass.id, pluginClass]))
        /** Every id reachable from `classId`'s own includes, to refuse a cycle. */
        const reachable = new Set()
        const walk = (id, seen) => {
          if (seen.has(id)) return
          seen.add(id)
          const pluginClass = byId.get(id)
          if (pluginClass === undefined) return
          for (const nested of pluginClass.include ?? []) {
            reachable.add(String(nested))
            walk(String(nested), seen)
          }
        }
        walk(classId, new Set())
        const current = Array.isArray(this.classById(classId)?.include)
          ? this.classById(classId).include.map(String)
          : []
        return classes.filter(candidate => candidate.id !== classId
          && !reachable.has(candidate.id)
          && (!isHidden(candidate) || current.includes(candidate.id)))
      }

      /** Classes selected for one session (empty means the bare host baseline). */
      selectionOf(sessionId, boundPreset) {
        // The bound preset id *is* the selection (`cls-host`, `cls-a`, `cls-a+b`),
        // so it is the truth. The `sessions` map is only a hint for a session no
        // preset has been chosen for yet — trusting it over the preset would show
        // stale ids after a rebind, and it is what keeps unknown/removed classes
        // out of the composition.
        const fromPreset = classIdsOf(boundPreset)
        if (fromPreset !== undefined) {
          const known = new Set((this.state.classes || []).map(pluginClass => pluginClass.id))
          return fromPreset.filter(id => known.has(id))
        }
        const recorded = this.state.sessions ? this.state.sessions[sessionId] : undefined
        return Array.isArray(recorded) ? recorded.filter(id => id !== HOST_CLASS_ID) : []
      }

      /** Names of the selected classes, falling back to the preset name. */
      selectionNames(ids) {
        const names = []
        for (const id of ids) {
          const found = this.state.classes.find(candidate => candidate.id === id)
          if (found !== undefined) names.push(found.name)
        }
        return names
      }

      /**
       * Ask the registry to bind a session to a combination and wait until the
       * host has registered that preset (volatile writes are asynchronous).
       * @param sessionId - session to rebind.
       * @param classIds - selected class ids.
       * @param options.attempts - polling budget.
       * @returns failure message, or undefined once bound.
       */
      async bind(sessionId, classIds) {
        const presetId = comboPresetId(classIds)
        const listed = await this.waitForPreset(presetId)
        if (!listed) return `preset ${presetId} did not become available`
        const result = await this.ctx.remote.agentPresets.select(sessionId, presetId)
        if (!result.ok) return result.error.message
        return undefined
      }

      /** Poll the roster until a preset id appears. */
      async waitForPreset(presetId, attempts = 25) {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const result = await this.ctx.remote.agentPresets.list()
          if (result.ok && (result.value.presets || []).some(row => row.id === presetId)) return true
          await new Promise(resolve => window.setTimeout(resolve, 160))
        }
        return false
      }

      /** Persist a session's class selection and rebind it when possible. */
      async selectClasses(sessionId, classIds, rebind) {
        // `settings.update` merges objects, so dropping a key is not possible:
        // record an empty list instead (the host skips empty selections).
        const next = Object.assign({}, this.state.sessions)
        next[sessionId] = classIds
        const failure = await this.patch({ sessions: next })
        if (failure !== undefined) return failure
        if (rebind !== true) return undefined
        return this.bind(sessionId, classIds)
      }

      /** Archive one session and forget it. */
      async archive(sessionId) {
        const workspace = this.ctx.get('uiWorkspace')
        if (workspace === undefined || workspace.archiveSession === undefined) return 'workspace service unavailable'
        try {
          await workspace.archiveSession(sessionId, { stopActivity: true })
          this.tempSessions.delete(sessionId)
          return undefined
        } catch (error) {
          return String(error && error.message ? error.message : error)
        }
      }

      /**
       * Start a one-turn temporary session for a combination this session may
       * not compose: DSH locks a composition after its first turn, so the answer
       * comes from a fresh blank session that is archived afterwards.
       * @param classIds - the combination to compose.
       * @param cwd - working directory inherited from the current session.
       * @returns the new session id, or a failure message.
       */
      async openOneTurnSession(classIds, cwd) {
        const created = await this.ctx.remote.session.create({ cwd })
        if (!created.ok) return created.error.message
        const tempId = created.value.sessionId
        const failure = await this.selectClasses(tempId, classIds, false)
        if (failure !== undefined) return failure
        const bound = await this.bind(tempId, classIds)
        if (bound !== undefined) return bound
        this.tempSessions.add(tempId)
        const workspace = this.ctx.get('uiWorkspace')
        if (workspace !== undefined && workspace.openSession !== undefined) workspace.openSession(tempId)
        return tempId
      }

      /** Archive finished one-turn sessions the operator has navigated away from. */
      reapTempSessions(byId, currentSessionId) {
        for (const tempId of [...this.tempSessions]) {
          if (tempId === currentSessionId) continue
          const summary = byId[tempId]
          if (summary !== undefined && summary.running === true) continue
          void this.archive(tempId)
        }
      }

      /** Sessions currently composing one class (directly or inside a combination). */
      sessionsUsing(classId, byId) {
        const rows = []
        for (const sessionId of Object.keys(byId || {})) {
          const summary = byId[sessionId]
          if (summary === undefined || summary === null) continue
          const ids = this.selectionOf(sessionId, (summary.projectionValues || {}).agentPreset)
          if (!ids.includes(classId)) continue
          rows.push(summary)
        }
        rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        return rows
      }

      /** Rows a bundle contributes when filed into a class. */
      rowsOfBundle(bundle) {
        if (bundle === undefined) return []
        const rows = Array.isArray(bundle.rows) ? bundle.rows : []
        const usable = rows.filter(row => row.moduleName !== undefined && String(row.moduleName).indexOf('cordis:') !== 0)
        if (usable.length === 0) return [{ id: '', name: bundle.name, disabled: false }]
        return usable.map(row => ({ id: row.rowId || '', name: row.moduleName, disabled: false }))
      }

      /**
       * File one downloaded plugin into classes: append its rows to each class,
       * record the assignment, and optionally disable its host-level row.
       * @param bundle - the installed bundle.
       * @param classIds - classes to file it into (empty means "not in any class").
       * @param disableHost - drop the host-level bundle row so only those classes see it.
       * @returns failure message, or undefined once saved.
       */
      async filePlugin(bundle, classIds, disableHost) {
        const rows = this.rowsOfBundle(bundle)
        const classes = this.state.classes.map((pluginClass) => {
          if (!classIds.includes(pluginClass.id)) return pluginClass
          const existing = Array.isArray(pluginClass.add) ? pluginClass.add.slice() : []
          const names = new Set(existing.map(entry => entry.name))
          for (const row of rows) if (!names.has(row.name)) existing.push(row)
          return Object.assign({}, pluginClass, { add: existing })
        })
        const plugins = Object.assign({}, this.state.plugins)
        plugins[bundle.name] = classIds.slice()
        const failure = await this.patch({ classes, plugins })
        if (failure !== undefined) return failure
        if (disableHost === true && classIds.length > 0) {
          const result = await this.ctx.remote.pluginManager.setBundleEnabled(bundle.name, false)
          if (!result.ok) return result.error.message
        }
        return undefined
      }
    }

    /** Subscribe a component to a store snapshot. */
    function useStore(store) {
      return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    }

    // ─── anchored popup ─────────────────────────────────────────────────────
    /** A fixed-position popup anchored above its trigger, portaled to the body. */
    function AnchoredMenu(props) {
      const menuRef = useRef(null)
      const [position, setPosition] = useState({ left: -9999, top: -9999, visibility: 'hidden' })

      useEffect(() => {
        if (props.open !== true) {
          setPosition({ left: -9999, top: -9999, visibility: 'hidden' })
          return undefined
        }
        const place = () => {
          const anchor = props.anchorRef.current
          const menu = menuRef.current
          if (anchor === null || menu === null) return
          const rect = anchor.getBoundingClientRect()
          const menuWidth = menu.offsetWidth
          const menuHeight = menu.offsetHeight
          const margin = 12
          let left = rect.right - menuWidth
          left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin))
          let top = rect.top - 8 - menuHeight
          if (top < margin) top = Math.min(rect.bottom + 8, window.innerHeight - menuHeight - margin)
          setPosition({ left, top, visibility: 'visible' })
        }
        place()
        const schedule = () => { window.requestAnimationFrame(place) }
        const onPointerDown = (event) => {
          const menu = menuRef.current
          const anchor = props.anchorRef.current
          if (menu !== null && menu.contains(event.target)) return
          if (anchor !== null && anchor.contains(event.target)) return
          props.onClose()
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          props.onClose()
        }
        window.addEventListener('resize', schedule)
        window.addEventListener('scroll', schedule, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('resize', schedule)
          window.removeEventListener('scroll', schedule, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [props.open, props.onClose, props.anchorRef])

      if (props.open !== true) return null
      return ReactDOM.createPortal(
        h('div', {
          ref: menuRef,
          className: 'dpc-menu',
          role: 'menu',
          'aria-label': props.label,
          style: { left: position.left, top: position.top, visibility: position.visibility },
        }, props.children),
        document.body,
      )
    }

    /** A checkbox square, visual only: the owning row handles the click. */
    function CheckBox({ checked }) {
      return h('span', { className: 'dpc-box', 'data-checked': String(checked) },
        checked ? h(CheckIcon, { size: 11 }) : null)
    }

    // ─── composer chip ──────────────────────────────────────────────────────
    /** The class chip: this session's class set, editable per class. */
    function ClassChip(props) {
      const { store, sessionId, t } = props
      const useSessions = props.useSessions
      const state = useStore(store)
      const [open, setOpen] = useState(false)
      const [pending, setPending] = useState(false)
      const [failure, setFailure] = useState(null)
      const anchorRef = useRef(null)

      const byId = useSessions !== undefined
        ? useSessions(snapshot => snapshot.byId)
        : store.ctx.sessions.list.getSnapshot().byId
      const summary = byId ? byId[sessionId] : undefined
      const values = (summary && summary.projectionValues) || {}
      const boundPreset = values.agentPreset
      const blank = summary !== undefined && summary !== null && summary.blank === true
      const selection = store.selectionOf(sessionId, boundPreset)
      const isTemp = store.tempSessions.has(sessionId)
      const names = store.selectionNames(selection)

      useEffect(() => { void store.load() }, [store])
      useEffect(() => { if (open) void store.load(true) }, [open, store])
      useEffect(() => {
        // Reaping outside this session keeps a finished one-turn session from
        // lingering once the operator moved on.
        if (!isTemp && byId !== undefined) store.reapTempSessions(byId, sessionId)
      }, [byId, isTemp, sessionId, store])

      const toggle = async (classId) => {
        const checked = selection.includes(classId)
        setFailure(null)
        if (checked) {
          if (!blank) {
            setFailure(t('menu.lockedOff'))
            return
          }
          setPending(true)
          const next = selection.filter(id => id !== classId)
          const problem = await store.selectClasses(sessionId, next, true)
          setPending(false)
          if (problem !== undefined) setFailure(problem)
          return
        }
        setPending(true)
        if (blank) {
          const next = selection.concat([classId])
          const problem = await store.selectClasses(sessionId, next, true)
          setPending(false)
          if (problem !== undefined) setFailure(problem)
          return
        }
        const combo = selection.concat([classId])
        const result = await store.openOneTurnSession(combo, summary && summary.cwd)
        setPending(false)
        if (typeof result === 'string' && result.length > 0 && result.startsWith('session-') === false) {
          setFailure(result)
          return
        }
        setOpen(false)
        store.flash(t('menu.oneTurn'))
      }

      const openManager = () => {
        setOpen(false)
        const layout = store.ctx.get('layout')
        if (layout !== undefined && layout.selectPanel !== undefined) layout.selectPanel(PANEL_ID)
      }

      const label = names.length === 0 ? t('chip.hostOnly') : names.join(' + ')

      const errorStrip = state.status === 'error'
        ? h('div', { className: 'dpc-error' },
          h('span', { key: 'm' }, state.error || t('menu.error')),
          h('button', { key: 'r', type: 'button', onClick: () => void store.load(true) }, t('menu.retry')))
        : null

      const rows = state.classes.filter(pluginClass => !isHidden(pluginClass)).map(pluginClass => {
        const checked = selection.includes(pluginClass.id)
        const roster = state.roster[presetIdOf(pluginClass.id)]
        const broken = roster ? roster.broken : undefined
        return h('button', {
          key: pluginClass.id,
          type: 'button',
          className: 'dpc-item',
          role: 'checkbox',
          'aria-checked': checked,
          disabled: pending || broken !== undefined || (checked && !blank),
          onClick: () => void toggle(pluginClass.id),
        },
        h(CheckBox, { checked }),
        h('span', { key: 'c', className: 'dpc-item-copy' },
          h('span', { className: 'dpc-item-name' }, pluginClass.name),
          pluginClass.description !== undefined && pluginClass.description !== ''
            ? h('span', { className: 'dpc-item-desc' }, pluginClass.description)
            : broken !== undefined ? h('span', { className: 'dpc-item-desc' }, broken) : null),
        h('span', { key: 'b', className: 'dpc-badge' }, checked ? t('panel.health.ok') : ''))
      })

      const body = rows.length === 0
        ? h('div', { className: 'dpc-empty-state' }, state.loading ? t('menu.loading') : t('menu.empty'))
        : rows

      const notBlankHint = blank ? null : h('div', { className: 'dpc-warn' }, t('menu.oneTurn'))

      const menu = h(AnchoredMenu, {
        open,
        anchorRef,
        label: t('menu.title'),
        onClose: () => setOpen(false),
      },
      h('div', { key: 'h', className: 'dpc-menu-head' }, t('menu.title')),
      errorStrip,
      failure !== null ? h('div', { key: 'f', className: 'dpc-error' }, failure) : null,
      notBlankHint,
      h('div', { key: 'b', className: 'dpc-menu-body' }, body),
      h('div', { key: 'n', className: 'dpc-note' }, t('menu.hint')),
      h('div', { key: 'o', className: 'dpc-menu-foot' },
        h('button', { type: 'button', className: 'dpc-item', onClick: openManager },
          h('span', { className: 'dpc-item-name' }, t('menu.manage'))),
        isTemp
          ? h('button', {
            type: 'button',
            className: 'dpc-item',
            onClick: () => {
              setOpen(false)
              void store.archive(sessionId).then((problem) => {
                if (problem !== undefined) store.flash(problem)
              })
            },
          }, h('span', { className: 'dpc-item-name' }, t('menu.endTemp')))
          : null))

      const trigger = h('button', {
        ref: anchorRef,
        type: 'button',
        className: 'dpc-chip',
        'aria-label': t('chip.aria'),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        title: blank ? t('chip.aria') : t('chip.locked'),
        onClick: () => setOpen(value => !value),
      },
      h('span', { key: 'i', className: 'dpc-chip-icon' }, h(PlugIcon, { size: 14 })),
      h('span', { key: 'l', className: 'dpc-chip-label' }, label),
      selection.length > 1 ? h('span', { key: 'n', className: 'dpc-chip-count' }, String(selection.length)) : null,
      h(ChevronDown, { key: 'c', size: 14 }))

      return h(React.Fragment, null, trigger, menu,
        state.notice !== null ? h('div', { className: 'dpc-toast' }, state.notice) : null)
    }

    // ─── sidebar icon ───────────────────────────────────────────────────────
    /** The sidebar entry's icon; `size` and `active` are the sidebar's own props. */
    function PanelIcon(props) {
      const size = props.size || 16
      return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: props.active === false ? 0.8 : 1 },
      }, h(PlugIcon, { size }))
    }

    // ─── assign dialog ──────────────────────────────────────────────────────
    /**
     * File one newly downloaded plugin into classes.
     * @param props.store - the shared store.
     * @param props.bundles - the bundles to file (usually one).
     * @param props.t - translate.
     * @param props.onClose - close the dialog.
     */
    function AssignDialog(props) {
      const { store, bundles, t, onClose } = props
      const state = useStore(store)
      const [picked, setPicked] = useState({})
      const [disableHost, setDisableHost] = useState(true)
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState(null)

      const classes = state.classes.filter(pluginClass => !isHidden(pluginClass))
      const toggle = (bundleName, classId) => {
        setPicked((current) => {
          const list = current[bundleName] || []
          const next = list.includes(classId) ? list.filter(id => id !== classId) : list.concat([classId])
          return Object.assign({}, current, { [bundleName]: next })
        })
      }

      const submit = async (fileInto) => {
        setBusy(true)
        setFailure(null)
        for (const bundle of bundles) {
          const classIds = fileInto ? (picked[bundle.name] || []) : []
          const problem = await store.filePlugin(bundle, classIds, fileInto && disableHost)
          if (problem !== undefined) {
            setFailure(`${t('assign.error')}: ${problem}`)
            setBusy(false)
            return
          }
        }
        setBusy(false)
        onClose()
      }

      return ReactDOM.createPortal(
        h('div', { className: 'dpc-overlay', role: 'presentation' },
          h('div', { className: 'dpc-dialog', role: 'dialog', 'aria-label': t('assign.title') },
            h('div', { className: 'dpc-dialog-head' },
              h('h2', null, t('assign.title')),
              h('p', null, t('assign.subtitle'))),
            h('div', { className: 'dpc-dialog-body' },
              failure !== null ? h('div', { className: 'dpc-error' }, failure) : null,
              bundles.length === 0 ? h('div', { className: 'dpc-muted' }, t('assign.empty')) : null,
              bundles.map(bundle => h('div', { key: bundle.name, className: 'dpc-plugin-card' },
                h('div', { className: 'dpc-plugin-name' }, bundleTitle(bundle)),
                h('div', { className: 'dpc-plugin-desc' }, localized(bundle.meta && bundle.meta.description) || bundle.name),
                h('div', { className: 'dpc-dialog-sub' }, t('assign.classes')),
                classes.length === 0
                  ? h('div', { className: 'dpc-muted' }, t('assign.empty'))
                  : classes.map(pluginClass => h('div', {
                    key: pluginClass.id,
                    className: 'dpc-dialog-item',
                    role: 'checkbox',
                    'aria-checked': (picked[bundle.name] || []).includes(pluginClass.id),
                    onClick: () => toggle(bundle.name, pluginClass.id),
                  },
                  h(CheckBox, { checked: (picked[bundle.name] || []).includes(pluginClass.id) }),
                  h('span', null, pluginClass.name))))),
              h('div', {
                className: 'dpc-dialog-toggle',
                role: 'checkbox',
                'aria-checked': disableHost,
                onClick: () => setDisableHost(value => !value),
              }, h(CheckBox, { checked: disableHost }), h('span', null, t('assign.disableHost')))),
            h('div', { className: 'dpc-dialog-foot' },
              h('button', { type: 'button', className: 'dpc-btn', disabled: busy, onClick: () => void submit(false) },
                t('assign.later')),
              h('button', { type: 'button', className: 'dpc-btn primary', disabled: busy, onClick: () => void submit(true) },
                busy ? t('assign.working') : t('assign.confirm'))))),
        document.body,
      )
    }

    // ─── management panel ───────────────────────────────────────────────────
    /** Small labelled field wrapper. */
    function Field(props) {
      return h('div', { className: 'dpc-field', style: props.style },
        props.htmlFor !== undefined ? h('label', { htmlFor: props.htmlFor }, props.label) : h('label', null, props.label),
        props.children)
    }

    /** One pill badge. */
    function Pill(props) {
      return h('span', { className: 'dpc-pill' + (props.tone ? ' ' + props.tone : '') }, props.children)
    }

    /**
     * One editable plugin note, drawn under the row it belongs to.
     *
     * Notes live in the shared `notes` map keyed by package or row name, so the
     * same text shows up wherever that plugin appears. Saving on blur keeps it to
     * one write per edit; Escape discards the draft.
     */
    function PluginNote(props) {
      const { store, t, name } = props
      useStore(store)
      const note = store.noteOf(name)
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(note)

      useEffect(() => {
        if (!editing) setDraft(note)
      }, [note, editing])

      const commit = () => {
        setEditing(false)
        const text = draft.trim()
        if (text === note) return
        void store.saveNote(name, text)
      }

      const slot = (child) => h('div', { className: 'dpc-note-slot' }, child)

      if (editing) {
        return slot(h('input', {
          className: 'dpc-note-input',
          value: draft,
          autoFocus: true,
          placeholder: t('note.placeholder'),
          onChange: (event) => setDraft(event.target.value),
          onBlur: commit,
          onKeyDown: (event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') {
              setDraft(note)
              setEditing(false)
            }
          },
        }))
      }

      return slot(h('button', {
        type: 'button',
        className: 'dpc-note-btn' + (note === '' ? ' empty' : ''),
        title: note === '' ? t('note.add') : t('note.edit'),
        onClick: () => setEditing(true),
      }, note === '' ? t('note.add') : note))
    }

    /** The `插件管理` panel: class CRUD, plugin membership and session usage. */
    function PluginManagerPanel(props) {
      const { store, t } = props
      const useSessions = props.useSessions
      const state = useStore(store)
      const [selectedId, setSelectedId] = useState(undefined)
      const [draftName, setDraftName] = useState('')
      const [draftDescription, setDraftDescription] = useState('')
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [manualName, setManualName] = useState('')
      const [filing, setFiling] = useState(null)
      const [message, setMessage] = useState(null)

      const byId = useSessions !== undefined
        ? useSessions(snapshot => snapshot.byId)
        : store.ctx.sessions.list.getSnapshot().byId

      useEffect(() => { void store.load() }, [store])

      const allClasses = state.classes
      const classes = allClasses.filter(pluginClass => !isHidden(pluginClass))
      let selected
      for (const pluginClass of classes) {
        if (pluginClass.id === selectedId) selected = pluginClass
      }
      if (selected === undefined && classes.length > 0) selected = classes[0]

      const selectedKey = selected ? selected.id : ''
      const selectedName = selected && selected.name ? selected.name : ''
      const selectedDescription = selected && selected.description ? selected.description : ''

      useEffect(() => {
        if (state.status === 'idle') return
        if (selectedId !== undefined && classes.some(pluginClass => pluginClass.id === selectedId)) return
        setSelectedId(classes.length > 0 ? classes[0].id : undefined)
      }, [classes, selectedId, state.status])

      useEffect(() => {
        setDraftName(selectedName)
        setDraftDescription(selectedDescription)
        setConfirmDelete(false)
      }, [selectedKey, selectedName, selectedDescription])

      const flash = (text) => {
        setMessage(text)
        window.setTimeout(() => setMessage(null), 2200)
      }

      const updateClass = async (classId, patch) => {
        const next = allClasses.map(pluginClass => pluginClass.id === classId
          ? Object.assign({}, pluginClass, patch)
          : pluginClass)
        const failure = await store.patch({ classes: next })
        if (failure !== undefined) flash(t('panel.err.save') + ': ' + failure)
      }

      const createClass = async () => {
        const pluginClass = {
          id: newClassId(),
          name: t('panel.title') + ' ' + String(classes.length + 1),
          description: '',
          base: 'standard',
          include: [],
          remove: [],
          add: [],
        }
        const failure = await store.patch({ classes: allClasses.concat([pluginClass]) })
        if (failure !== undefined) flash(t('panel.err.save') + ': ' + failure)
        else setSelectedId(pluginClass.id)
      }

      /**
       * Delete a class the safe way: move every blank session that had it onto
       * the remaining selection, then *hide* the class instead of removing it.
       * Removing it would retire its preset id, and a session still bound to
       * that id could never be adopted again — New Session reuses blank
       * sessions, so that breaks the whole new-session surface.
       *
       * The `sessions` map of other sessions is deliberately left alone: their
       * combination keeps composing because the class is still there, just
       * hidden, so those sessions still mount exactly what they mounted before.
       */
      const deleteClass = async (classId) => {
        for (const sessionId of Object.keys(byId || {})) {
          const summary = byId[sessionId]
          if (summary === undefined || summary === null || summary.blank !== true) continue
          const ids = store.selectionOf(sessionId, (summary.projectionValues || {}).agentPreset)
          if (!ids.includes(classId)) continue
          await store.selectClasses(sessionId, ids.filter(id => id !== classId), true)
        }
        const failure = await store.patch({
          classes: allClasses.map(pluginClass => pluginClass.id === classId
            ? Object.assign({}, pluginClass, {
              ...(store.canHide() ? { hidden: true } : {}),
              name: HIDDEN_PREFIX + (pluginClass.name || pluginClass.id),
            })
            : pluginClass),
        })
        setConfirmDelete(false)
        if (failure !== undefined) flash(t('panel.err.save') + ': ' + failure)
        else {
          setSelectedId(undefined)
          flash(t('panel.deleted'))
        }
      }

      const commitName = async () => {
        if (selected === undefined) return
        const name = draftName.trim()
        if (name === '') { flash(t('panel.err.name')); return }
        const duplicate = classes.some(pluginClass => pluginClass.id !== selected.id && pluginClass.name === name)
        if (duplicate) { flash(t('panel.err.dup')); return }
        if (name === selectedName && draftDescription === selectedDescription) return
        await updateClass(selected.id, { name, description: draftDescription })
        flash(t('panel.saved'))
      }

      const toggleRow = (rowKey) => {
        if (selected === undefined) return
        const remove = Array.isArray(selected.remove) ? selected.remove : []
        const next = remove.indexOf(rowKey) >= 0 ? remove.filter(key => key !== rowKey) : remove.concat([rowKey])
        void updateClass(selected.id, { remove: next })
      }

      const addBundle = (bundle) => {
        if (selected === undefined) return
        const add = Array.isArray(selected.add) ? selected.add : []
        const rows = store.rowsOfBundle(bundle)
        const names = new Set(add.map(entry => entry.name))
        const missing = rows.filter(row => !names.has(row.name))
        if (missing.length === 0) return
        void updateClass(selected.id, { add: add.concat(missing) })
      }

      const removePlugin = (index) => {
        if (selected === undefined) return
        const add = Array.isArray(selected.add) ? selected.add.slice() : []
        add.splice(index, 1)
        void updateClass(selected.id, { add })
      }

      const presetId = selected === undefined ? undefined : presetIdOf(selected.id)
      const roster = presetId === undefined ? undefined : state.roster[presetId]
      const usedBy = selected === undefined ? [] : store.sessionsUsing(selected.id, byId)
      const rows = presetId === undefined ? [] : (state.presetRows[presetId] || [])
      const removed = new Set(selected && Array.isArray(selected.remove) ? selected.remove : [])
      const additions = selected && Array.isArray(selected.add) ? selected.add : []
      const includeIds = selected && Array.isArray(selected.include) ? selected.include.map(String) : []
      const includeSet = new Set(includeIds)
      const includeCandidates = selected === undefined ? [] : store.includeCandidates(selected.id)

      /**
       * Include or drop another class. A class composes the classes it includes
       * before its own delta, so this is how one class can stand for a group of
       * plugins without re-listing them; `includeCandidates` already hides the
       * ids that would close a cycle.
       */
      const toggleInclude = (classId) => {
        if (selected === undefined) return
        const next = includeSet.has(classId)
          ? includeIds.filter(id => id !== classId)
          : includeIds.concat([classId])
        void updateClass(selected.id, { include: next })
      }
      const pending = store.pendingBundles()
      const availableBundles = state.bundles.filter(bundle => bundle.enabled !== true)
      const hostBundles = state.bundles.filter(bundle => bundle.enabled === true)

      const classButtons = classes.map(pluginClass => h('button', {
        key: pluginClass.id,
        type: 'button',
        className: 'dpc-rail-item',
        'data-active': String(pluginClass.id === (selected ? selected.id : '')),
        onClick: () => setSelectedId(pluginClass.id),
      },
      h('span', { className: 'dpc-rail-name' }, pluginClass.name),
      h('span', { className: 'dpc-rail-sub' },
        [
          Array.isArray(pluginClass.add) && pluginClass.add.length > 0 ? '+' + pluginClass.add.length : '',
          Array.isArray(pluginClass.include) && pluginClass.include.length > 0 ? '⟲' + pluginClass.include.length : '',
        ].filter(part => part !== '').join(' ') || '基线')))
      const hostNote = h('div', { key: '__host', className: 'dpc-rail-host' }, t('panel.hostNote'))
      const railItems = classes.length === 0 ? [] : classButtons.concat([hostNote])

      const rail = h('div', { className: 'dpc-rail' },
        classes.length === 0
          ? h('div', { className: 'dpc-muted' }, state.loading ? t('menu.loading') : t('panel.empty'))
          : railItems)

      const rowItems = rows.map((row, index) => {
        const key = row.entryId || row.moduleName || String(index)
        const present = !removed.has(key) && !removed.has(row.moduleName)
        return h('div', { key, className: 'dpc-row' },
          h('label', null,
            h('input', { type: 'checkbox', checked: present, onChange: () => toggleRow(key) }),
            h('span', null, shortName(row.moduleName)),
            h('code', null, row.moduleName)),
          row.enabled === false ? h(Pill, null, 'disabled') : null,
          h('span', { className: 'dpc-row-id' }, key),
          h(PluginNote, { store, t, name: row.moduleName || key }))
      })

      const additionItems = additions.map((entry, index) => h('div', {
        key: (entry.name || '') + '-' + String(index),
        className: 'dpc-row',
      },
      h('label', null,
        h('span', null, shortName(entry.name)),
        h('code', null, entry.name)),
      h(PluginNote, { store, t, name: entry.name }),
      h('button', {
        type: 'button',
        className: 'dpc-btn',
        onClick: () => removePlugin(index),
      }, t('panel.removeOne'))))

      const availableItems = availableBundles.map(bundle => h('div', { key: bundle.name, className: 'dpc-row' },
        h('label', null,
          h('span', null, bundleTitle(bundle)),
          h('code', null, bundle.name)),
        (state.plugins && Array.isArray(state.plugins[bundle.name]) && state.plugins[bundle.name].length > 0)
          ? h(Pill, { tone: 'ok' }, t('panel.added'))
          : null,
        h(PluginNote, { store, t, name: bundle.name }),
        h('button', {
          type: 'button',
          className: 'dpc-btn',
          disabled: additions.some(entry => entry.name === bundle.name),
          onClick: () => addBundle(bundle),
        }, t('panel.addOne'))))

      const hostItems = hostBundles.map(bundle => h('div', { key: bundle.name, className: 'dpc-row' },
        h('label', null,
          h('span', null, bundleTitle(bundle)),
          h('code', null, bundle.name)),
        h(Pill, null, 'host-level'),
        h(PluginNote, { store, t, name: bundle.name })))

      const sessionItems = usedBy.map(summary => {
        const id = summary.id || summary.sessionId
        return h('div', { key: id, className: 'dpc-session' },
          h('span', { className: 'dpc-session-title' }, summary.displayTitle || id),
          summary.blank === true ? h(Pill, null, t('panel.sessionsBlank')) : null,
          summary.running === true ? h(Pill, null, 'running') : null)
      })
 
      const deleteAction = confirmDelete
        ? h(React.Fragment, null,
          h('button', { key: 'd', type: 'button', className: 'dpc-btn danger', onClick: () => void deleteClass(selected.id) },
            t('panel.deleteConfirm')),
          h('button', { key: 'c', type: 'button', className: 'dpc-btn', onClick: () => setConfirmDelete(false) },
            t('panel.cancel')))
        : h('button', { key: 'd', type: 'button', className: 'dpc-btn danger', onClick: () => setConfirmDelete(true) },
          t('panel.delete'))

      const actionsRow = h('div', { className: 'dpc-inline', style: { justifyContent: 'flex-end', alignItems: 'center', marginBottom: 6 } },
        h('span', { style: { color: 'var(--dsw-alias-label-tertiary,#78828f)', fontSize: 11, lineHeight: '16px', marginRight: 'auto' } },
          t('panel.deleteHint')),
        deleteAction)

      const healthRow = h('div', { className: 'dpc-inline', style: { marginBottom: 4 } },
        h(Field, { label: t('panel.health'), style: { marginBottom: 0, minWidth: 150 } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap' } },
            h(Pill, { tone: roster && roster.broken !== undefined ? 'bad' : 'ok' },
              roster && roster.broken !== undefined ? t('panel.health.broken') : t('panel.health.ok')),
            roster && roster.broken !== undefined
              ? h('code', { style: { fontSize: 11 } }, roster.broken)
              : null)),
        h(Field, { label: t('panel.classId'), style: { marginBottom: 0, minWidth: 200 } },
          h('code', { style: { fontSize: 11, lineHeight: '20px' } }, presetId || '')))

      const detail = selected === undefined
        ? h('div', { className: 'dpc-muted' }, t('panel.pick'))
        : h(React.Fragment, null,
          h(Field, { htmlFor: 'dpc-name', label: t('panel.name') },
            h('input', {
              id: 'dpc-name',
              value: draftName,
              onChange: (event) => setDraftName(event.target.value),
              onBlur: () => void commitName(),
              onKeyDown: (event) => { if (event.key === 'Enter') void commitName() },
            })),
          h(Field, { htmlFor: 'dpc-desc', label: t('panel.description') },
            h('input', {
              id: 'dpc-desc',
              value: draftDescription,
              placeholder: t('menu.hint'),
              onChange: (event) => setDraftDescription(event.target.value),
              onBlur: () => void commitName(),
              onKeyDown: (event) => { if (event.key === 'Enter') void commitName() },
            })),
          h('div', { className: 'dpc-section' },
            h('h2', null, t('panel.includes')),
            h('span', null, t('panel.includesHint'))),
          includeCandidates.length === 0
            ? h('div', { className: 'dpc-muted' }, t('panel.includesEmpty'))
            : h('div', { className: 'dpc-list' }, includeCandidates.map(candidate => h('div', {
              key: candidate.id,
              className: 'dpc-row',
            },
            h('label', null,
              h('input', {
                type: 'checkbox',
                checked: includeSet.has(candidate.id),
                onChange: () => toggleInclude(candidate.id),
              }),
              h('span', null, candidate.name || candidate.id),
              candidate.description !== undefined && candidate.description !== ''
                ? h('code', null, candidate.description)
                : h('span', { className: 'dpc-row-id' }, presetIdOf(candidate.id)))))),
          healthRow,
          actionsRow,
          state.saving ? h('div', { className: 'dpc-note' }, t('panel.saving')) : null,
          state.saveError !== null
            ? h('div', { className: 'dpc-error' }, t('panel.err.save') + ': ' + state.saveError)
            : null,
          pending.length === 0 ? null : h(React.Fragment, null,
            h('div', { className: 'dpc-section' },
              h('h2', null, t('panel.pending')),
              h('span', null, t('panel.pendingHint'))),
            h('div', { className: 'dpc-list' }, pending.map(bundle => h('div', { key: bundle.name, className: 'dpc-row' },
              h('label', null,
                h('span', null, bundleTitle(bundle)),
                h('code', null, bundle.name)),
              h('button', {
                type: 'button',
                className: 'dpc-btn primary',
                onClick: () => setFiling(bundle),
              }, t('panel.pendingOpen')))))),
          h('div', { className: 'dpc-section' },
            h('h2', null, t('panel.rows')),
            h('span', null, t('panel.rowsHint'))),
          rows.length === 0
            ? h('div', { className: 'dpc-muted' }, state.loading ? t('menu.loading') : t('panel.rowsHint'))
            : h('div', { className: 'dpc-list' }, rowItems),
          h('div', { className: 'dpc-section' }, h('h2', null, t('panel.added'))),
          additions.length === 0
            ? h('div', { className: 'dpc-muted' }, t('panel.addedEmpty'))
            : h('div', { className: 'dpc-list' }, additionItems),
          h('div', { className: 'dpc-section' },
            h('h2', null, t('panel.add')),
            h('span', null, t('panel.addHint'))),
          availableBundles.length === 0
            ? h('div', { className: 'dpc-muted' }, t('panel.addEmpty'))
            : h('div', { className: 'dpc-list' }, availableItems),
          h('div', { className: 'dpc-inline', style: { marginTop: 8 } },
            h('input', {
              placeholder: t('panel.manualPlaceholder'),
              value: manualName,
              onChange: (event) => setManualName(event.target.value),
              style: { boxSizing: 'border-box', height: 30, padding: '0 8px', width: 260, border: '1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12))', borderRadius: 8, background: 'transparent', color: 'inherit', fontFamily: 'inherit', fontSize: 13 },
            }),
            h('button', {
              type: 'button',
              className: 'dpc-btn',
              disabled: manualName.trim() === '',
              onClick: () => {
                const name = manualName.trim()
                if (name === '') return
                setManualName('')
                if (additions.some(entry => entry.name === name)) return
                void updateClass(selected.id, { add: additions.concat([{ id: '', name, disabled: false }]) })
              },
            }, t('panel.addOne'))),
          h('div', { className: 'dpc-section' },
            h('h2', null, t('panel.host')),
            h('span', null, t('panel.hostHint'))),
          hostBundles.length === 0
            ? h('div', { className: 'dpc-muted' }, t('panel.addEmpty'))
            : h('div', { className: 'dpc-list' }, hostItems),
          h('div', { className: 'dpc-section' }, h('h2', null, t('panel.sessions'))),
          usedBy.length === 0
            ? h('div', { className: 'dpc-muted' }, t('panel.sessionsEmpty'))
            : h('div', { className: 'dpc-list' }, sessionItems))

      const body = state.status === 'error'
        ? h('div', { className: 'dpc-detail' },
          h('div', { className: 'dpc-error' },
            h('span', { key: 'm' }, t('panel.err.load') + ': ' + (state.error || '')),
            h('button', { key: 'r', type: 'button', onClick: () => void store.load(true) }, t('menu.retry'))))
        : h('div', { className: 'dpc-panel-body' }, rail, h('div', { className: 'dpc-detail' }, detail))

      const header = h('div', { className: 'dpc-panel-head' },
        h('div', null,
          h('h1', null, t('panel.title')),
          h('p', null, t('panel.subtitle'))),
        h('span', { className: 'dpc-spacer' }),
        h('button', {
          type: 'button',
          className: 'dpc-btn primary',
          disabled: state.saving,
          onClick: () => void createClass(),
        }, h(PlusIcon, { size: 13 }), t('panel.new')),
        h('button', {
          type: 'button',
          className: 'dpc-btn',
          onClick: () => {
            const layout = store.ctx.get('layout')
            if (layout !== undefined && layout.selectPanel !== undefined) layout.selectPanel(null)
          },
        }, t('panel.back')))

      return h('div', { className: 'dpc-panel' },
        header,
        body,
        message !== null ? h('div', { className: 'dpc-toast' }, message) : null,
        filing !== null
          ? h(AssignDialog, { store, t, bundles: [filing], onClose: () => setFiling(null) })
          : null)
    }

    // ─── plugin ─────────────────────────────────────────────────────────────
    /**
     * Required client services.
     *
     * `remote` alone is only the Remote hub: every generated namespace is its
     * own `remote.<namespace>` Service, and Cordis refuses a property read the
     * plugin did not declare here.
     */
    exports.inject = [
      'slots',
      'locale',
      'sessions',
      'remote',
      'remote.settings',
      'remote.agentPresets',
      'remote.pluginManager',
      'remote.pluginInventory',
      'remote.session',
    ]

    /** Browser plugin body: dictionaries, the shared store and the three surfaces. */
    exports.apply = function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-classes: dictionaries')
      ctx.effect(() => installStyles(), 'plugin-classes: styles')

      const store = new ClassesStore(ctx)
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        void store.load(true)
        const offSettings = ctx.remote.$on('settings/document-updated', (ns) => {
          if (ns === ENTRY_ID) void store.load(true)
        })
        const offPlugins = ctx.remote.$on('plugin-manager/changed', () => { void store.load(true) })
        const offReset = ctx.on('connection/reset', () => { void store.load(true) })
        return () => {
          if (typeof offSettings === 'function') offSettings()
          if (typeof offPlugins === 'function') offPlugins()
          if (typeof offReset === 'function') offReset()
        }
      }, 'plugin-classes: refresh')

      // 1. Composer chip, immediately left of the model selector.
      ctx.inject(['slots'], (scope) => {
        scope.slots.inject('conversation.input.right', () => scope.slots.register({
          name: 'conversation.input.right',
          id: 'plugin-class',
          order: 20,
          locale: NS,
          inject: (sessionId) => ({ store, sessionId }),
        }, ClassChip))
      })

      // Debug handle for verification scripts: the live store plus the bundles
      // still waiting to be filed. Read-only by convention.
      Object.defineProperty(window, '__dshPluginClasses', {
        configurable: true,
        value: {
          store,
          pending: () => store.pendingBundles().map(bundle => bundle.name),
          state: () => store.getSnapshot(),
        },
      })

      // 2. Sidebar panel: the 插件管理 directory.
      ctx.inject(['slots'], (scope) => {
        scope.slots.inject('main', () => scope.slots.inject('sidebar.panellist', () => {
          const stopMain = scope.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ store }),
          }, PluginManagerPanel)
          let stopIcon
          try {
            stopIcon = scope.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: () => t('panel.label'),
              locale: NS,
            }, PanelIcon)
          } catch (error) {
            stopMain()
            throw error
          }
          return () => {
            if (typeof stopIcon === 'function') stopIcon()
            stopMain()
          }
        }))
      })

      // 3. Assign dialog for plugins that were downloaded but never filed.
      // A session-scoped list slot, so it renders inside the resident composer
      // while a session is mounted; the dialog itself portals to the body.
      ctx.inject(['slots'], (scope) => {
        scope.slots.inject('conversation.input.dock', () => scope.slots.register({
          name: 'conversation.input.dock',
          id: 'plugin-class-assign',
          order: 30,
          locale: NS,
          inject: () => ({ store }),
        }, function AssignOverlay(props) {
          const state = useStore(props.store)
          const [dismissed, setDismissed] = useState({})
          const pending = state.status === 'ready'
            ? props.store.pendingBundles().filter(bundle => dismissed[bundle.name] !== true)
            : []
          if (pending.length === 0) return null
          return h(AssignDialog, {
            store: props.store,
            t: props.t,
            bundles: pending,
            onClose: () => {
              const next = Object.assign({}, dismissed)
              for (const bundle of pending) next[bundle.name] = true
              setDismissed(next)
            },
          })
        }))
      })
    }

    return module.exports
  },
})
