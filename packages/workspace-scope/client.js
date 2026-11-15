window.__ModuleLoader__.load({
  id: '@local/dsh-workspace-scope',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useMemo, useRef, useState } = React;

    const API = '/workspace-scope/api/v1';
    const SELECTED_KEY = 'workspace-scope:selected';
    const QUARANTINE_PANEL_KEY = 'workspace-scope-quarantine';
    const QUARANTINE_SELECTED_KEY = 'workspace-scope:quarantine-workspace';

    async function request(path, init) {
      const headers = { ...(init?.body ? { 'content-type': 'application/json' } : {}) };
      const response = await fetch(`${API}${path}`, { cache: 'no-store', ...init, headers: { ...headers, ...(init?.headers || {}) } });
      const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body.data;
    }

    function match(pattern, name) {
      if (pattern === name) return true;
      if (!pattern.includes('*')) return false;
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`).test(name);
    }
    function matchesAny(patterns, name) {
      return Array.isArray(patterns) && patterns.some((p) => typeof p === 'string' && match(p, name));
    }

    function mcpServerWildcard(server) {
      return `mcp__${server}__*`;
    }

    function mcpServerOn(policy, server) {
      const wildcard = mcpServerWildcard(server);
      return matchesAny(policy?.tools?.allow, wildcard) && !matchesAny(policy?.tools?.deny, wildcard);
    }

    function mcpToolOn(policy, server, tool) {
      if (matchesAny(policy?.tools?.deny, tool)) return false;
      return mcpServerOn(policy, server) || matchesAny(policy?.tools?.allow, tool);
    }

    function mcpServersOf(cap) {
      if (Array.isArray(cap?.mcp)) return cap.mcp;
      const servers = new Map();
      for (const [name, description] of Object.entries(cap?.toolDescriptions || {})) {
        const parsed = /^mcp__(.+?)__(.+)$/.exec(name);
        if (!parsed) continue;
        const [, server, label] = parsed;
        if (!servers.has(server)) servers.set(server, []);
        servers.get(server).push({ name, label, description });
      }
      return [...servers.entries()]
        .map(([id, tools]) => ({ id, name: id, tools }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    function collectToolRows(groups = [], ungrouped = [], descriptions = {}) {
      const rows = [];
      const seen = new Set();
      function push(name, groupKey, groupName) {
        if (!name || seen.has(name)) return;
        seen.add(name);
        rows.push({ name, groupKey, groupName, description: descriptions[name] || '' });
      }
      for (const group of groups) {
        for (const tool of group.tools || []) push(tool, group.id, group.name);
        for (const sub of group.subgroups || []) {
          for (const tool of sub.tools || []) push(tool, `${group.id}.${sub.id}`, `${group.name}/${sub.name}`);
        }
      }
      for (const item of ungrouped) push(item.name, '', '未分组');
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    function groupOptionsFor(groups = [], customGroups = [], removedGroups = [], purgedGroups = []) {
      const hidden = new Set([...removedGroups, ...purgedGroups]);
      const map = new Map();
      for (const group of groups) {
        if (!group || hidden.has(group.id)) continue;
        map.set(group.id, group.name);
        for (const sub of group.subgroups || []) {
          if (!hidden.has(`${group.id}.${sub.id}`)) map.set(`${group.id}.${sub.id}`, `${group.name}/${sub.name}`);
        }
      }
      for (const group of customGroups) {
        if (group && typeof group.id === 'string' && typeof group.name === 'string'
          && !hidden.has(group.id) && !map.has(group.id)) {
          map.set(group.id, group.name);
        }
      }
      return [...map.entries()]
        .map(([key, name]) => ({ key, name }))
        .concat([{ key: '', name: '未分组工具' }]);
    }
    function clonePolicy(policy) {
      return {
        ...policy,
        groups: { ...(policy.groups || {}) },
        tools: { allow: [...(policy.tools?.allow || [])], deny: [...(policy.tools?.deny || [])] },
        sections: { allow: [...(policy.sections?.allow || [])], deny: [...(policy.sections?.deny || [])] },
        rules: { ...(policy.rules || {}) },
        identity: { ...(policy.identity || {}) },
        memory: { ...(policy.memory || {}) },
      };
    }

    function templateToPolicy(template) {
      const switches = template?.switches || {};
      return {
        version: 1,
        enabled: true,
        template: template?.id || 'default',
        groups: { ...(switches.groups || {}) },
        favorites: false,
        tools: { allow: [...(switches.tools?.allow || [])], deny: [...(switches.tools?.deny || [])] },
        sections: { allow: [], deny: [] },
        rules: { global: true },
        identity: { persona: '', soulEnabled: false, soul: '' },
        memory: { project: '', theme: '', reviewMode: 'auto' },
      };
    }

    function templateFromPolicy(policy, base) {
      return {
        ...base,
        switches: {
          groups: { ...(policy.groups || {}) },
          tools: {
            allow: [...(policy.tools?.allow || [])],
            deny: [...(policy.tools?.deny || [])],
          },
        },
      };
    }

    const styles = {
      page: { maxWidth: 1080, margin: '0 auto', padding: '28px 32px 64px', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit', boxSizing: 'border-box' },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      h1: { margin: 0, fontSize: 24, lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.01em' },
      sub: { margin: '8px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1.55 },
      toolbar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 18 },
      grid: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16, alignItems: 'stretch' },
      card: { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: 18, minWidth: 0 },
      cardTitle: { margin: '0 0 14px', fontSize: 15, lineHeight: 1.35, fontWeight: 600 },
      subTitle: { margin: '6px 0 10px', fontSize: 14, fontWeight: 600 },
      anchorNav: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', position: 'sticky', top: 0, zIndex: 30, background: 'var(--dsw-alias-bg-base)', borderBottom: '1px solid var(--dsw-alias-border-l1)', padding: '8px 0', marginBottom: 12 },
      anchorButton: { background: 'transparent', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', transition: 'background-color .12s ease, color .12s ease, border-color .12s ease' },
      stickyBar: { position: 'sticky', bottom: 0, zIndex: 30, marginTop: 16, padding: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', background: 'var(--dsw-alias-bg-base)', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      row: { display: 'flex', alignItems: 'center', gap: 9 },
      groupRow: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', minWidth: 0 },
      groupName: { fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      count: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.55 },
      input: { background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%', minHeight: 34 },
      select: { background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', maxWidth: 360, minHeight: 34 },
      templatePicker: { position: 'relative', width: '100%' },
      templateButton: { background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left', cursor: 'pointer', boxSizing: 'border-box', minHeight: 34 },
      templateMenu: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 50, background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.20)', maxHeight: 320, overflow: 'auto' },
      templateMenuItem: { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-primary)', padding: '8px 11px', cursor: 'pointer', fontFamily: 'inherit' },
      templateMenuItemActive: { background: 'var(--dsw-alias-bg-layer-2)' },
      templateMenuDesc: { display: 'block', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.4, marginTop: 2, whiteSpace: 'normal' },
      button: { background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 34 },
      buttonAccent: { background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #111)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 34 },
      buttonDanger: { background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 34 },
      status: { fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)' },
      ok: { color: 'var(--dsw-alias-state-success-primary)' },
      error: { color: 'var(--dsw-alias-state-error-primary)' },
      banner: { marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', lineHeight: 1.55 },
      modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
      modal: { width: 'min(460px, 100%)', background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.28)' },
      wizard: { width: 'min(780px, 100%)', maxHeight: '86vh', overflow: 'auto', background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,0.28)', boxSizing: 'border-box' },
      wizardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
      wizardStep: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginTop: 4 },
      wizardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 20, flexWrap: 'wrap', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 16 },
      templateOption: { textAlign: 'left', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: 14, cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 },
      templateOptionActive: { borderColor: 'var(--dsw-alias-brand-primary)', boxShadow: '0 0 0 1px var(--dsw-alias-brand-primary) inset' },
      templateOptionName: { fontSize: 13, fontWeight: 600, marginBottom: 3 },
      manage: { width: 'min(1120px, 96vw)', height: 'min(820px, 90vh)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,0.28)', boxSizing: 'border-box' },
      manageTabs: { display: 'flex', gap: 18, borderBottom: '1px solid var(--dsw-alias-border-l1)', marginBottom: 12 },
      manageTab: { background: 'transparent', color: 'var(--dsw-alias-label-secondary)', border: 0, padding: '8px 0', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'stretch' },
      manageTabActive: { color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
      manageList: { overflow: 'auto', flex: '1 1 0', minHeight: 0, marginTop: 8, borderTop: '1px solid var(--dsw-alias-border-l1)' },
      manageGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 14px' },
      manageToolCard: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 84px', gap: 12, alignItems: 'start', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', minWidth: 0 },
      manageSubhead: { margin: '12px 0 4px', fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      manageRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 180px', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      manageToolName: { fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      manageDesc: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.4, marginTop: 2, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0 },
      manageGroupChips: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 },
      toolList: { marginTop: 6, maxHeight: 260, overflow: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 4 },
      toolRow: { display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 0 },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
      previewTool: { display: 'inline-block', margin: '2px 4px 2px 0', padding: '3px 7px', borderRadius: 5, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      previewToolGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px 16px', maxHeight: 260, overflow: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 6 },
      previewToolName: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      divider: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l1)', margin: '14px 0' },
    };

    function Checkbox({ checked, onChange, label, disabled }) {
      return h('label', { style: { ...styles.row, minWidth: 0, cursor: disabled ? 'default' : 'pointer' } },
        h('input', {
          type: 'checkbox', checked, disabled,
          onChange: (event) => onChange(event.target.checked),
          style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto' },
        }),
        h('span', { style: { fontSize: 13, lineHeight: 1.4, minWidth: 0 } }, label));
    }

    function Button({ children, onClick, style, disabled, title }) {
      return h('button', {
        type: 'button', onClick, disabled, title,
        style: { ...(style || styles.button), opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
      }, children);
    }

    /** Shared provider/model catalog fetched from the Host once per client. */
    let modelsPromise = null;
    function loadModels() {
      if (!modelsPromise) {
        modelsPromise = request('/models')
          .then((data) => (Array.isArray(data?.models) ? data.models : []))
          .catch(() => []);
      }
      return modelsPromise;
    }

    function ModelSelect({ value, onChange, emptyLabel = '默认（DSH 代理默认模型）' }) {
      const [models, setModels] = useState(null);
      useEffect(() => {
        let alive = true;
        loadModels().then((list) => { if (alive) setModels(list); });
        return () => { alive = false; };
      }, []);
      const list = models || [];
      const known = new Set(list.map((model) => model.value));
      const options = [];
      if (value && !known.has(value)) {
        options.push({ value, label: `${value}（当前）` });
      }
      for (const model of list) {
        options.push({ value: model.value, label: `${model.providerName || model.provider} / ${model.name || model.id}` });
      }
      return h('select', {
        value: value || '',
        disabled: models === null,
        onChange: (event) => onChange(event.target.value),
        style: { ...styles.input, width: '100%', boxSizing: 'border-box' },
      },
      h('option', { value: '' }, emptyLabel),
      ...options.map((option) => h('option', { key: option.value, value: option.value }, option.label)));
    }

    /** Time-picker editor for dream suppression windows, plus a 24h preview. */
    function SuppressWindowsEditor({ value, onChange }) {
      const parseTime = (text) => {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return null;
        return hour * 60 + minute;
      };
      const parsed = typeof value === 'string'
        ? value.split(/[,，]/).flatMap((part) => {
            const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(part.trim());
            return match ? [{ start: match[1], end: match[2] }] : [];
          })
        : value;
      const windows = (Array.isArray(parsed) ? parsed : [])
        .filter((item) => item && typeof item.start === 'string' && typeof item.end === 'string');
      const update = (index, key, next) => {
        onChange(windows.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: next } : item));
      };
      const remove = (index) => onChange(windows.filter((_, itemIndex) => itemIndex !== index));
      const add = () => onChange([...windows, { start: '09:00', end: '12:00' }]);
      const segments = [];
      for (const item of windows) {
        const start = parseTime(item.start);
        const end = parseTime(item.end);
        if (start === null || end === null || start === end) continue;
        if (start < end) {
          segments.push({ left: start / 14.4, width: (end - start) / 14.4 });
        } else {
          segments.push({ left: start / 14.4, width: (1440 - start) / 14.4 });
          segments.push({ left: 0, width: end / 14.4 });
        }
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        windows.length === 0
          ? h('span', { style: styles.muted }, '未设置抑制时段。')
          : windows.map((item, index) => h('div', { key: `${index}-${item.start}-${item.end}`, style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
              h('span', { style: { ...styles.muted, fontSize: 11 } }, `时段 ${index + 1}`),
              h('input', {
                type: 'time', value: item.start, step: 60,
                onChange: (event) => update(index, 'start', event.target.value),
                style: { ...styles.input, width: 104 },
              }),
              h('span', { style: styles.muted }, '—'),
              h('input', {
                type: 'time', value: item.end, step: 60,
                onChange: (event) => update(index, 'end', event.target.value),
                style: { ...styles.input, width: 104 },
              }),
              h(Button, { onClick: () => remove(index), style: styles.buttonDanger }, '移除'))),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h(Button, { onClick: add }, '添加时段'),
          h('span', { style: styles.muted }, '支持跨午夜，如 22:00—02:00')),
        h('div', { style: { position: 'relative', height: 14, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2, #f3f5f8)', marginTop: 2 } },
          segments.map((segment, index) => h('div', {
            key: `segment-${index}`,
            title: 'dream 抑制时段',
            style: {
              position: 'absolute', top: 0, bottom: 0,
              left: `${segment.left}%`, width: `${Math.max(0.5, segment.width)}%`,
              boxSizing: 'border-box',
              background: 'color-mix(in srgb, #6b8fb5 18%, var(--dsw-alias-bg-layer-2, #f3f5f8))',
              border: '1px solid color-mix(in srgb, #6b8fb5 34%, var(--dsw-alias-bg-layer-2, #f3f5f8))',
            },
          }))),
        h('div', { style: { ...styles.muted, display: 'flex', justifyContent: 'space-between', fontSize: 11 } },
          h('span', null, '00:00'), h('span', null, '06:00'), h('span', null, '12:00'), h('span', null, '18:00'), h('span', null, '24:00')));
    }

    /** Workspace SOUL editor: reads/writes the memory plugin's host route. */
    function SoulEditor({ enabled, content, loaded, busy, status, onChange, onSave }) {
      if (!enabled) return null;

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('h3', { style: styles.subTitle }, '工作区 SOUL'),
        h('p', { style: { ...styles.muted, marginTop: 0 } }, '这段内容只属于当前工作区；独立于记忆，默认只有你能修改，AI 写入受“允许 AI 写 SOUL”开关控制。'),
        h('textarea', {
          value: content,
          rows: 6,
          disabled: !loaded || busy,
          placeholder: '例如：这个工作区里你应如何介绍自己、优先遵守哪些习惯……',
          onChange: (event) => onChange(event.target.value),
          style: { ...styles.input, resize: 'vertical', width: '100%', boxSizing: 'border-box' },
        }),
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 } },
          h(Button, { onClick: onSave, disabled: !loaded || busy, style: styles.buttonAccent }, busy ? '保存中…' : '保存 SOUL'),
          status ? h('span', { style: styles.muted }, status) : null));
    }

    /** Review queue for memories that failed the theme judge. */
    function QuarantineList({ workspace, enabled, collapsible = false, standalone = false }) {
      const [items, setItems] = useState([]);
      const [busyId, setBusyId] = useState('');
      const [status, setStatus] = useState('');
      const [open, setOpen] = useState(!collapsible);
      const path = workspace?.path;

      const refresh = () => {
        if (!enabled || typeof path !== 'string' || path.length === 0) return;
        fetch(`/meow-memory/quarantine?workspace=${encodeURIComponent(path)}`, { cache: 'no-store' })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body.ok) {
              setStatus(String(body.error || '') === 'memory not enabled for workspace'
                ? '当前工作区未启用记忆；请先在设置中开启记忆。'
                : '记忆插件不可用');
              return;
            }
            setItems(Array.isArray(body.items) ? body.items : []);
            setStatus('');
          })
          .catch(() => setStatus('读取暂存区失败'));
      };

      useEffect(() => {
        setItems([]);
        setStatus('');
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [enabled, path]);

      if (!enabled) return null;

      async function act(id, action) {
        if (busyId || typeof path !== 'string') return;
        setBusyId(id);
        setStatus('');
        try {
          const response = await fetch('/meow-memory/quarantine', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspace: path, id, action }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
          refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : '操作失败');
        } finally {
          setBusyId('');
        }
      }

      const pendingItems = items.filter((item) => item.origin === 'manual');
      const judgeItems = items.filter((item) => item.origin !== 'manual');

      async function actMany(rows, action) {
        if (busyId || typeof path !== 'string' || rows.length === 0) return;
        setBusyId('__batch__');
        setStatus('');
        let failed = 0;
        try {
          for (const item of rows) {
            const response = await fetch('/meow-memory/quarantine', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspace: path, id: item.id, action }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body.ok) failed += 1;
          }
          setStatus(failed > 0 ? `${failed} 条处理失败，请刷新后重试。` : '已批量处理。');
          refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : '批量操作失败');
        } finally {
          setBusyId('');
        }
      }

      const renderItem = (item) => {
        const manual = item.origin === 'manual';
        const ageDays = manual && item.created_at
          ? Math.floor((Date.now() - Number(item.created_at)) / 86_400_000)
          : 0;
        return h('div', {
          key: item.id,
          style: { border: '1px solid var(--dsw-alias-border, #ddd)', borderRadius: 8, padding: 10 },
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('strong', { style: { fontSize: 12 } }, item.level || 'memory'),
            item.domain === 'tooling' ? h('span', { style: styles.muted }, '工具') : null,
            item.theme ? h('span', { style: styles.muted }, `主题：${item.theme}`) : null,
            item.reason ? h('span', { style: styles.muted }, item.reason) : null,
            manual && ageDays >= 7 ? h('span', { style: { ...styles.muted, color: 'var(--dsw-alias-state-warning-primary, #b26a00)' } }, `已等待 ${ageDays} 天`) : null),
          h('div', { style: { marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 } }, String(item.content || '').slice(0, 500)),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            h(Button, { onClick: () => { void act(item.id, 'restore'); }, disabled: busyId === item.id || busyId === '__batch__' }, manual ? '纳入主库' : '恢复到主库'),
            h(Button, { onClick: () => { void act(item.id, 'delete'); }, disabled: busyId === item.id || busyId === '__batch__', style: styles.buttonDanger }, '丢弃')));
      };

      const renderSection = (title, rows, manual) => {
        if (rows.length === 0) return null;
        return h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: 12, minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
            h('h3', { style: { margin: 0, fontSize: 14, fontWeight: 600 } }, title),
            h('span', { style: styles.muted }, `${rows.length} 条`)),
          h('p', { style: { ...styles.muted, margin: '6px 0 8px' } }, manual
            ? '手动审批写入的记忆。纳入后进入主库并参与注入；丢弃后不可恢复。'
            : '主题 judge 判定不匹配或不确定的记忆，不会进入自动注入。'),
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' } },
            h(Button, { onClick: () => { void actMany(rows, 'restore'); }, disabled: Boolean(busyId) }, manual ? '全部纳入' : '全部恢复'),
            h(Button, { onClick: () => { void actMany(rows, 'delete'); }, disabled: Boolean(busyId), style: styles.buttonDanger }, '全部丢弃')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, rows.map(renderItem)));
      };

      const content = items.length === 0
        ? h('p', { style: styles.muted }, status || '暂存区和待审区都为空。')
        : h('div', {
            style: pendingItems.length > 0 && judgeItems.length > 0
              ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, alignItems: 'start' }
              : { display: 'flex', flexDirection: 'column', gap: 12 },
          },
            renderSection('待审区（手动审批）', pendingItems, true),
            renderSection('暂存区（主题 judge）', judgeItems, false));

      if (standalone) {
        return h('div', null,
          h('p', { style: { ...styles.muted, marginTop: 0 } }, '手动审批和主题 judge 的记忆只存在这里，不会进入自动注入。'),
          content,
          status && items.length > 0 ? h('p', { style: { ...styles.muted, marginBottom: 0 } }, status) : null);
      }

      return h('section', { style: { ...styles.card, marginBottom: 14 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 } },
            h('h2', { style: { ...styles.cardTitle, margin: 0 } }, '工作区记忆管理'),
            collapsible ? h('span', { style: styles.muted }, `${items.length} 条`) : null),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            collapsible ? h(Button, { onClick: () => setOpen((value) => !value) }, open ? '收起' : '展开') : null,
            h(Button, { onClick: refresh, disabled: !enabled }, '刷新'))),
        (!collapsible || open) && h('div', null,
          h('p', { style: { ...styles.muted, marginTop: 0 } }, '手动审批和主题 judge 的记忆只存在这里，不会进入自动注入。'),
          content,
          status && items.length > 0 ? h('p', { style: { ...styles.muted, marginBottom: 0 } }, status) : null));
    }

    /** Standalone global panel: quarantine review only, with a workspace picker. */
    function QuarantinePage({ onClose }) {
      const [workspaces, setWorkspaces] = useState([]);
      const [workspaceId, setWorkspaceId] = useState(() => localStorage.getItem(QUARANTINE_SELECTED_KEY) || '');
      const [error, setError] = useState('');

      useEffect(() => {
        let alive = true;
        request('/workspaces')
          .then((list) => {
            if (!alive) return;
            const rows = Array.isArray(list) ? list : [];
            setWorkspaces(rows);
            setWorkspaceId((current) => {
              if (current && rows.some((item) => item.id === current)) return current;
              const saved = localStorage.getItem(QUARANTINE_SELECTED_KEY);
              return rows.find((item) => item.id === saved)?.id || rows[0]?.id || '';
            });
          })
          .catch((err) => { if (alive) setError(String(err.message || err)); });
        return () => { alive = false; };
      }, []);

      useEffect(() => {
        if (workspaceId) localStorage.setItem(QUARANTINE_SELECTED_KEY, workspaceId);
      }, [workspaceId]);

      const workspace = workspaces.find((item) => item.id === workspaceId);

      return h('div', { style: {
        ...styles.page,
        maxWidth: 980,
        width: '100%',
        height: '100%',
        maxHeight: '100vh',
        minHeight: 0,
        margin: '0 auto',
        overflowY: 'auto',
        overflowX: 'hidden',
      } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' } },
          h('div', null,
            h('h1', { style: styles.h1 }, '工作区记忆管理'),
            h('p', { style: { ...styles.muted, marginTop: 2 } }, '这里放手动审批和主题 judge 的记忆；可以纳入/恢复主库或丢弃。')),
          h(Button, { onClick: onClose }, '关闭')),
        h('section', { style: { ...styles.card, marginBottom: 14 } },
          h('div', { style: styles.toolbar },
            h('span', { style: styles.muted }, '工作区'),
            h('select', {
              value: workspaceId,
              onChange: (event) => setWorkspaceId(event.target.value),
              style: { ...styles.select, minWidth: 260, maxWidth: '100%' },
            }, workspaces.map((item) => h('option', { key: item.id, value: item.id }, `${item.title} — ${item.path}`))),
            workspace ? h('span', { style: styles.code }, workspace.path) : null)),
        error ? h('p', { style: { ...styles.muted, color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
        !workspace && !error ? h('p', { style: styles.muted }, '没有可用工作区。') : null,
        workspace ? h(QuarantineList, { workspace, enabled: true, standalone: true }) : null);
    }

    /** Per-workspace detailed memory switches (all default on). */
    function MemorySwitchPanel({ policy, setMemory, workspace }) {
      if (!policy || policy.memory?.enabled !== true) return null;
      const dbPath = workspace?.path ? `${workspace.path}\\.dsh-scope\\memory.db` : '';
      const toggle = (group, key, checked) => setMemory(group, {
        ...(policy.memory?.[group] || {}),
        [key]: checked,
      });
      const row = (group, key, label) => h(Checkbox, {
        key: `${group}.${key}`,
        checked: policy.memory?.[group]?.[key] !== false,
        onChange: (checked) => toggle(group, key, checked),
        label,
      });
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('h3', { style: styles.subTitle }, '记忆详细开关'),
        h('p', { style: { ...styles.muted, marginTop: 0 } }, '总开关开启时按默认值工作；以下参数只影响该工作区。'),
        dbPath ? h('div', { style: { ...styles.muted, marginBottom: 8, wordBreak: 'break-all' } },
          '记忆库：',
          h('span', { style: styles.code }, dbPath),
          '（WAL 模式；数据可能暂存在同目录的 memory.db-wal，主库文件看起来小是正常的）') : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 8 } },
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '命中条数'),
            h('input', { type: 'number', min: 1, max: 20, value: policy.memory?.hitTopK ?? 6, onChange: (event) => setMemory('hitTopK', Number(event.target.value)), style: styles.input })),
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆触发间隔（轮）'),
            h('input', { type: 'number', min: 1, max: 20, value: policy.memory?.hitEveryN ?? 2, onChange: (event) => setMemory('hitEveryN', Number(event.target.value)), style: styles.input }),
            h('span', { style: { ...styles.muted, fontSize: 10 } }, '每 N 个真实用户轮触发一次关键词命中；首轮只注入快照')),
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '标题最大长度'),
            h('input', { type: 'number', min: 10, max: 200, value: policy.memory?.titleMax ?? 40, onChange: (event) => setMemory('titleMax', Number(event.target.value)), style: styles.input })),
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '反思工具轮数'),
            h('input', { type: 'number', min: 1, max: 50, value: policy.memory?.reflectTurns ?? 20, onChange: (event) => setMemory('reflectTurns', Number(event.target.value)), style: styles.input })),
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '反思/dream 模型'),
            h(ModelSelect, {
              value: policy.memory?.delegateModel || '',
              onChange: (value) => setMemory('delegateModel', value),
              emptyLabel: '默认（DSH 代理默认模型）',
            }))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 8 } },
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, 'dream 空闲分钟'),
            h('input', { type: 'number', min: 1, value: policy.memory?.dream?.idleMinutes ?? 180, onChange: (event) => setMemory('dream', { ...(policy.memory?.dream || {}), idleMinutes: Number(event.target.value) }), style: styles.input })),
          h('div', { style: { minWidth: 0, gridColumn: '1 / -1' } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, 'dream 抑制时段'),
            h(SuppressWindowsEditor, {
              value: policy.memory?.dream?.suppressWindows ?? [],
              onChange: (windows) => setMemory('dream', { ...(policy.memory?.dream || {}), suppressWindows: windows }),
            })),
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '抑制提前分钟'),
            h('input', { type: 'number', min: 0, value: policy.memory?.dream?.suppressLeadMinutes ?? 15, onChange: (event) => setMemory('dream', { ...(policy.memory?.dream || {}), suppressLeadMinutes: Number(event.target.value) }), style: styles.input })),
          h('label', { style: { minWidth: 0 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, 'dream 时区'),
            h('input', { value: policy.memory?.dream?.timeZone || 'Asia/Shanghai', onChange: (event) => setMemory('dream', { ...(policy.memory?.dream || {}), timeZone: event.target.value }), style: styles.input }))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4 } },
          row('inject', 'snapshot', '首轮快照注入'),
          row('inject', 'hits', '每消息关键词命中'),
          row('inject', 'reinject', '压缩后重注入'),
          row('tools', 'read', '记忆读取工具'),
          row('tools', 'write', '记忆写入工具'),
          row('auto', 'reflect', '自动反思'),
          row('auto', 'dream', '自动 dream'),
          row('auto', 'theme', '自动主题提案')));
    }

    function ToolRow({ tool, checked, onChange, description, disabled = false }) {
      return h('label', { style: { ...styles.toolRow, alignItems: 'flex-start', padding: '5px 0', opacity: disabled ? 0.55 : 1 } },
        h('input', { type: 'checkbox', checked, disabled, onChange: (event) => onChange(event.target.checked), style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 } }),
        h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
          h('span', { style: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tool),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.35 } }, description || '（暂无描述）')));
    }

    /** Dynamic MCP server group: authorization is stored as tools.allow/deny
     *  patterns, never as a second MCP-only switch. */
    function McpGroupCard({ server, policy, descriptions = {}, onServer, onTool }) {
      const serverOn = mcpServerOn(policy, server.id);
      const tools = server.tools || [];
      const onCount = tools.filter((tool) => mcpToolOn(policy, server.id, tool.name)).length;
      return h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 6, marginTop: 4 } },
        h('div', { style: styles.groupRow },
          h('input', {
            type: 'checkbox', checked: serverOn,
            onChange: (event) => onServer(server.id, event.target.checked),
            style: { accentColor: 'var(--dsw-alias-brand-primary)' },
          }),
          h('span', { style: styles.groupName }, `MCP · ${server.name}`),
          h('span', { style: styles.count }, `${serverOn ? '整组开启' : '关闭'} · ${onCount}/${tools.length} 工具`)),
        h('p', { style: { ...styles.muted, margin: '2px 0 4px' } }, '由 MCP 客户端动态注册；这里只控制本工作区是否允许调用，工具本身由 MCP Server 提供。'),
        h('details', { style: { marginLeft: 24 } },
          h('summary', { style: { ...styles.muted, cursor: 'pointer', padding: '2px 0' } }, '查看/调整单个工具'),
          h('div', { style: styles.toolList },
            tools.map((tool) => h(ToolRow, {
              key: tool.name,
              tool: tool.label || tool.name,
              description: descriptions[tool.name] || tool.description,
              checked: mcpToolOn(policy, server.id, tool.name),
              disabled: !serverOn,
              onChange: (checked) => onTool(tool.name, true, checked),
            })))));
    }

    function GroupCard({ group, policy, descriptions = {}, onGroup, onSubgroup, onTool }) {
      const groupOn = policy.groups[group.id] === true;
      const subgroups = group.subgroups || [];
      const topTools = group.tools || [];
      const totalTools = topTools.length + subgroups.reduce((sum, sub) => sum + (sub.tools || []).length, 0);
      const subOn = (sub) => groupOn || policy.groups[`${group.id}.${sub.id}`] === true;
      const toolChecked = (tool, baseOn) => baseOn ? !matchesAny(policy.tools.deny, tool) : matchesAny(policy.tools.allow, tool);

      if (group.virtual) {
        return h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 6, marginTop: 4 } },
          h('div', { style: styles.groupRow },
            h('span', { style: styles.groupName }, group.name),
            h('span', { style: styles.count }, `${topTools.length} 工具 · 未归类`)),
          h('p', { style: { ...styles.muted, margin: '2px 0 4px' } }, '不属于任何能力组；托管工作区默认隐藏，勾选后按单工具允许。'),
          h('div', { style: { ...styles.toolList, marginLeft: 0, maxHeight: 260 } },
            topTools.map((tool) => h(ToolRow, {
              key: tool, tool, description: descriptions[tool],
              checked: toolChecked(tool, false),
              onChange: (checked) => onTool(tool, false, checked),
            }))));
      }

      return h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 6, marginTop: 4 } },
        h('div', { style: styles.groupRow },
          h('input', {
            type: 'checkbox', checked: groupOn,
            onChange: (event) => onGroup(group, event.target.checked),
            style: { accentColor: 'var(--dsw-alias-brand-primary)' },
          }),
          h('span', { style: styles.groupName }, group.name),
          h('span', { style: styles.count }, `${groupOn ? '整组开启' : '关闭'} · ${totalTools} 工具`)),
        h('details', { style: { marginLeft: 24 } },
          h('summary', { style: { ...styles.muted, cursor: 'pointer', padding: '2px 0' } }, '查看/调整单个工具'),
          subgroups.length > 0 && h('div', { style: { marginTop: 4 } },
            subgroups.map((sub) => h('div', { key: sub.id, style: { marginTop: 4 } },
              h('div', { style: styles.row },
                h('input', {
                  type: 'checkbox', checked: subOn(sub), disabled: groupOn,
                  onChange: (event) => onSubgroup(group, sub, event.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary)' },
                }),
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, sub.name),
                h('span', { style: styles.count }, `${(sub.tools || []).length} 工具`)),
              (sub.tools || []).length > 0 && h('div', { style: { ...styles.toolList, marginLeft: 24 } },
                (sub.tools || []).map((tool) => h(ToolRow, {
                  key: tool, tool, description: descriptions[tool],
                  checked: toolChecked(tool, subOn(sub)),
                  onChange: (checked) => onTool(tool, subOn(sub), checked),
                })))))),
          topTools.length > 0 && h('div', { style: styles.toolList },
            topTools.map((tool) => h(ToolRow, {
              key: tool, tool, description: descriptions[tool],
              checked: toolChecked(tool, groupOn),
              onChange: (checked) => onTool(tool, groupOn, checked),
            })))));
    }

    function AutoWizardDialog({ workspace, onDone }) {
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [cap, setCap] = useState(null);
      const [templates, setTemplates] = useState([]);
      const [policy, setPolicy] = useState(null);
      const [revision, setRevision] = useState(null);
      const [templateId, setTemplateId] = useState('default');
      const [step, setStep] = useState(1);
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const [capData, templatesData, policyData] = await Promise.all([
              request('/capabilities'),
              request('/templates'),
              request(`/workspaces/${encodeURIComponent(workspace.id)}/policy`),
            ]);
            if (!alive) return;
            const base = policyData.policy ?? policyData.draft;
            if (!base) throw new Error('没有可用的策略草稿');
            setCap(capData);
            setTemplates(templatesData.templates || []);
            setPolicy(clonePolicy(base));
            setRevision(policyData.revision ?? null);
            setTemplateId(base.template || 'default');
          } catch (err) {
            if (alive) setError(String(err.message || err));
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => { alive = false; };
      }, [workspace.id]);

      const toolStates = useMemo(() => {
        const rows = [];
        for (const group of cap?.groups || []) {
          const groupOn = policy?.groups?.[group.id] === true;
          for (const tool of group.tools || []) {
            const on = groupOn ? !matchesAny(policy?.tools?.deny, tool) : matchesAny(policy?.tools?.allow, tool);
            rows.push({ name: tool, on });
          }
          for (const sub of group.subgroups || []) {
            const subOn = groupOn || policy?.groups?.[`${group.id}.${sub.id}`] === true;
            for (const tool of sub.tools || []) {
              const on = subOn ? !matchesAny(policy?.tools?.deny, tool) : matchesAny(policy?.tools?.allow, tool);
              rows.push({ name: tool, on });
            }
          }
        }
        for (const item of cap?.ungrouped || []) {
          rows.push({ name: item.name, on: matchesAny(policy?.tools?.allow, item.name) });
        }
        for (const server of mcpServersOf(cap)) {
          for (const tool of server.tools || []) {
            rows.push({ name: tool.name, on: mcpToolOn(policy, server.id, tool.name) });
          }
        }
        return rows;
      }, [cap, policy]);
      const enabledCount = toolStates.filter((row) => row.on).length;
      const enabledGroups = (cap?.groups || []).flatMap((group) => {
        const ids = [];
        if (policy?.groups?.[group.id] === true) ids.push(group.name);
        for (const sub of group.subgroups || []) {
          if (policy?.groups?.[`${group.id}.${sub.id}`] === true) ids.push(`${group.name}/${sub.name}`);
        }
        return ids;
      });

      function patch(updater) {
        setPolicy((current) => {
          if (!current) return current;
          const next = clonePolicy(current);
          updater(next);
          return next;
        });
      }
      function setGroup(group, on) {
        patch((next) => {
          if (on) next.groups[group.id] = true;
          else delete next.groups[group.id];
          for (const sub of group.subgroups || []) delete next.groups[`${group.id}.${sub.id}`];
        });
      }
      function setSubgroup(group, sub, on) {
        patch((next) => {
          const key = `${group.id}.${sub.id}`;
          if (on) next.groups[key] = true;
          else delete next.groups[key];
        });
      }
      function setTool(tool, baseOn, checked) {
        patch((next) => {
          if (baseOn) {
            const denied = matchesAny(next.tools.deny, tool);
            if (checked && denied) next.tools.deny = next.tools.deny.filter((item) => item !== tool);
            if (!checked && !denied) next.tools.deny = [...next.tools.deny, tool];
          } else {
            const allowed = matchesAny(next.tools.allow, tool);
            if (checked && !allowed) next.tools.allow = [...next.tools.allow, tool];
            if (!checked && allowed) next.tools.allow = next.tools.allow.filter((item) => item !== tool);
          }
        });
      }
      function setMcpServer(server, on) {
        patch((next) => {
          const prefix = `mcp__${server}__`;
          const wildcard = mcpServerWildcard(server);
          next.tools.allow = (next.tools.allow || []).filter((item) => !item.startsWith(prefix));
          next.tools.deny = (next.tools.deny || []).filter((item) => item !== wildcard);
          if (on) next.tools.allow.push(wildcard);
          else next.tools.deny.push(wildcard);
        });
      }
      function setRule(key, checked) {
        patch((next) => { next.rules[key] = checked; });
      }
      function setMemory(key, value) {
        patch((next) => {
          next.memory[key] = value;
          if ((key === 'judge' && value === false) || (key === 'reviewMode' && value !== 'auto')) next.memory.theme = '';
        });
      }
      function setPersona(value) {
        patch((next) => { next.identity.persona = value; });
      }
      function selectTemplate(id) {
        const template = templates.find((item) => item.id === id);
        if (!template) return;
        const switches = template.switches || {};
        setTemplateId(id);
        patch((next) => {
          next.template = id;
          next.groups = { ...(switches.groups || {}) };
          next.tools = {
            allow: [...(switches.tools?.allow || [])],
            deny: [...(switches.tools?.deny || [])],
          };
        });
      }
      function setAll(checked) {
        patch((next) => {
          next.groups = checked
            ? Object.fromEntries((cap?.groups || []).map((group) => [group.id, true]))
            : {};
          next.tools = {
            allow: checked
              ? [
                  ...(cap?.ungrouped || []).map((tool) => tool.name),
                  ...mcpServersOf(cap).map((server) => mcpServerWildcard(server.id)),
                ]
              : [],
            deny: [],
          };
        });
      }

      async function finish() {
        if (!policy) return;
        setBusy(true);
        setNotice(null);
        try {
          await request(`/workspaces/${encodeURIComponent(workspace.id)}/policy`, {
            method: 'PUT',
            body: JSON.stringify({ policy, revision }),
          });
          onDone();
        } catch (err) {
          setNotice({ type: 'error', text: String(err.message || err) });
        } finally {
          setBusy(false);
        }
      }

      function content() {
        if (step === 1) {
          return h('div', null,
            h('p', { style: { ...styles.muted, marginTop: 0 } }, '选一个模板作为起点；模板只切换能力组和单工具，规则/SOUL/记忆保持默认。'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 } },
              templates.map((template) => h('button', {
                key: template.id,
                type: 'button',
                onClick: () => selectTemplate(template.id),
                style: { ...styles.templateOption, ...(templateId === template.id ? styles.templateOptionActive : {}) },
              },
                h('div', { style: styles.templateOptionName }, template.name),
                h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.4 } }, template.description || '（无描述）')))));
        }
        if (step === 2) {
          return h('div', null,
            h('p', { style: { ...styles.muted, marginTop: 0 } }, '按需开启能力组；每个工具下方有说明，也可以单独调整工具。'),
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 8 } },
              h(Button, { onClick: () => setAll(true) }, '一键全选'),
              h(Button, { onClick: () => setAll(false) }, '取消全选')),
            (cap?.groups || []).map((group) => h(GroupCard, {
              key: `auto-${group.id}`, group, policy, descriptions: cap?.toolDescriptions || {},
              onGroup: setGroup, onSubgroup: setSubgroup, onTool: setTool,
            })),
            mcpServersOf(cap).map((server) => h(McpGroupCard, {
              key: `auto-mcp-${server.id}`,
              server,
              policy,
              descriptions: cap?.toolDescriptions || {},
              onServer: setMcpServer,
              onTool: setTool,
            })),
            cap?.ungrouped?.length > 0 && h(GroupCard, {
              key: 'auto-ungrouped',
              group: { id: 'ungrouped', name: '未分组', virtual: true, tools: cap.ungrouped.map((tool) => tool.name) },
              policy,
              descriptions: cap?.toolDescriptions || {},
              onGroup: setGroup,
              onSubgroup: setSubgroup,
              onTool: setTool,
            }));
        }
        if (step === 3) {
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            h(Checkbox, {
              checked: policy?.rules?.global !== false,
              onChange: (checked) => setRule('global', checked),
              label: '全局 RULE（跨工作区；关闭时同时隐藏 global_rule 工具）',
            }),
            h('p', { style: { ...styles.muted, margin: 0 } }, '工作区 SOUL 在创建后于「工作区扩展 → 规则、身份与记忆」中编辑。'),
            h('label', { style: { display: 'block', marginTop: 0 } },
              h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆审核模式'),
              h('select', {
                value: policy?.memory?.reviewMode || (policy?.memory?.judge === false ? 'off' : 'auto'),
                onChange: (event) => setMemory('reviewMode', event.target.value),
                style: { ...styles.select, width: '100%', maxWidth: '100%' },
              },
                h('option', { value: 'auto' }, '自动 judge：主题匹配才入库'),
                h('option', { value: 'off' }, '关闭 judge：全部直接入库'),
                h('option', { value: 'manual' }, '手动审批：全部进待审区'))),
            h('p', { style: { ...styles.muted, margin: 0 } }, '自动模式需要主题；关闭或手动模式默认没有主题，也不会再询问是否设置主题。'),
            (policy?.memory?.reviewMode || (policy?.memory?.judge === false ? 'off' : 'auto')) === 'auto' && h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
              h('label', { style: { flex: '1 1 220px', minWidth: 0 } },
                h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆主题'),
                h('input', { value: policy?.memory?.theme || '', onChange: (event) => setMemory('theme', event.target.value), style: styles.input }))),
            h('label', { style: { ...styles.toolRow, padding: '5px 0', marginTop: 4 } },
              h('input', {
                type: 'checkbox', checked: policy?.memory?.enabled === true,
                onChange: (event) => setMemory('enabled', event.target.checked),
                style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
              }),
              h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                h('span', { style: { fontSize: 12 } }, '启用记忆（本工作区）'),
                h('span', { style: { ...styles.muted, fontSize: 11 } }, '关闭时不建库、不注入、不注册记忆工具'))),
            h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 } },
              h('label', { style: { flex: '1 1 260px', minWidth: 0 } },
                h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, 'judge 模型'),
                h(ModelSelect, {
                  value: policy?.memory?.judgeModel || '',
                  onChange: (value) => setMemory('judgeModel', value),
                  emptyLabel: '默认（DSH 代理默认模型）',
                })),
              h('label', { style: { ...styles.toolRow, flex: '0 0 auto', padding: '5px 0' } },
                h('input', {
                  type: 'checkbox', checked: policy?.memory?.soulAiWritable === true,
                  onChange: (event) => setMemory('soulAiWritable', event.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
                }),
                h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('span', { style: { fontSize: 12 } }, '允许 AI 写 SOUL'),
                  h('span', { style: { ...styles.muted, fontSize: 11 } }, '默认关；用户始终可编辑')))));
        }
        const template = templates.find((item) => item.id === templateId);
        return h('div', null,
          h('p', { style: { ...styles.muted, marginTop: 0 } }, '确认后写入该工作区的 policy.json；当前已打开的会话仍受旧策略影响，新会话按新策略装配。'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 14px', fontSize: 13, lineHeight: 1.5 } },
            h('span', { style: styles.muted }, '工作区'), h('span', null, `${workspace.title || ''}（${workspace.path || ''}）`),
            h('span', { style: styles.muted }, '起始模板'), h('span', null, template?.name || templateId || '（无）'),
            h('span', { style: styles.muted }, '已启用工具'), h('span', null, `${enabledCount} / ${toolStates.length}`),
            h('span', { style: styles.muted }, '能力组'), h('span', null, enabledGroups.length ? enabledGroups.join('、') : '（无）'),
            h('span', { style: styles.muted }, '全局 RULE（跨工作区）'), h('span', null, policy?.rules?.global === false ? '关闭' : '开启')));
      }

      if (loading) {
        return h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal }, h('p', { style: styles.muted }, '正在读取新工作区…')));
      }
      if (error || !policy) {
        return h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal },
            h('h3', { style: { margin: '0 0 8px', fontSize: 16 } }, '新工作区向导'),
            h('p', { style: { ...styles.muted, color: 'var(--dsw-alias-state-error-primary)' } }, error || '没有可用的策略草稿'),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 12 } },
              h(Button, { onClick: onDone }, '关闭'))));
      }

      return h('div', { style: styles.modalBackdrop },
        h('div', { style: styles.wizard },
          h('div', { style: styles.wizardHeader },
            h('div', null,
              h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, `新工作区：${workspace.title || workspace.path}`),
              h('div', { style: styles.wizardStep }, `步骤 ${step} / 4 · ${['选择模板', '调整能力', '规则与 SOUL', '确认并保存'][step - 1]}`)),
            h(Button, { onClick: onDone, disabled: busy }, '关闭')),
          notice && h('div', { style: { ...styles.banner, color: 'var(--dsw-alias-state-error-primary)' } }, notice.text),
          content(),
          h('div', { style: styles.wizardFooter },
            h(Button, { onClick: () => setStep((value) => Math.max(1, value - 1)), disabled: busy || step === 1 }, '上一步'),
            h(Button, { onClick: () => setStep((value) => Math.min(4, value + 1)), disabled: busy || step === 4 }, '下一步'),
            h(Button, { onClick: finish, disabled: busy || step !== 4, style: styles.buttonAccent }, busy ? '保存中…' : '完成并保存'))));
    }

    function NewWorkspaceAutoWizard() {
      const [target, setTarget] = useState(null);
      const seenRef = useRef(null);
      const KEY = 'workspace-scope:auto-wizard-seen';

      function persist(seen) {
        try { localStorage.setItem(KEY, JSON.stringify([...seen])); } catch { /* ignore */ }
      }

      useEffect(() => {
        let cancelled = false;
        const poll = async () => {
          try {
            const list = await request('/workspaces');
            if (cancelled) return;
            let seen = seenRef.current;
            if (!seen) {
              let initialized = false;
              try {
                const raw = localStorage.getItem(KEY);
                if (raw) {
                  const parsed = JSON.parse(raw);
                  if (Array.isArray(parsed)) {
                    seen = new Set(parsed);
                    initialized = true;
                  }
                }
              } catch { /* ignore */ }
              if (!initialized) {
                seen = new Set(list.map((workspace) => workspace.id));
                persist(seen);
              }
              seenRef.current = seen;
            }
            for (const workspace of list) {
              if (seen.has(workspace.id)) continue;
              if (workspace.managed && (workspace.groups?.length ?? 0) === 0) {
                setTarget((current) => current ?? workspace);
              }
            }
          } catch { /* API may not be ready */ }
        };
        poll();
        const timer = setInterval(poll, 2000);
        return () => { cancelled = true; clearInterval(timer); };
      }, []);

      function done() {
        if (target && seenRef.current) {
          seenRef.current.add(target.id);
          persist(seenRef.current);
        }
        setTarget(null);
      }

      return target ? h(AutoWizardDialog, { key: target.id, workspace: target, onDone: done }) : null;
    }

    function WorkspaceScopePage({ close, onOpenQuarantine }) {
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [cap, setCap] = useState(null);
      const [workspaces, setWorkspaces] = useState([]);
      const [templates, setTemplates] = useState([]);
      const [workspaceId, setWorkspaceId] = useState(() => localStorage.getItem(SELECTED_KEY) || '');
      const [managed, setManaged] = useState(false);
      const [policy, setPolicy] = useState(null);
      const [savedPolicy, setSavedPolicy] = useState(null);
      const [revision, setRevision] = useState(null);
      const [soulContent, setSoulContent] = useState('');
      const [soulOriginal, setSoulOriginal] = useState('');
      const [soulLoaded, setSoulLoaded] = useState(false);
      const [soulStatus, setSoulStatus] = useState('');
      const [soulBusy, setSoulBusy] = useState(false);
      const [exitPrompt, setExitPrompt] = useState(false);
      const [preview, setPreview] = useState(null);
      const [templateId, setTemplateId] = useState('default');
      const [editingTemplate, setEditingTemplate] = useState(false);
      const [templateDraft, setTemplateDraft] = useState(null);
      const [templateName, setTemplateName] = useState('');
      const [templateDescription, setTemplateDescription] = useState('');
      const [savingTemplate, setSavingTemplate] = useState(false);
      const [templateIsNew, setTemplateIsNew] = useState(false);
      const [saveDialog, setSaveDialog] = useState(false);
      const [copyDialog, setCopyDialog] = useState(false);
      const [copyName, setCopyName] = useState('');
      const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
      const [wizardOpen, setWizardOpen] = useState(false);
      const [wizardStep, setWizardStep] = useState(1);
      const [wizardPolicy, setWizardPolicy] = useState(null);
      const [wizardTemplateId, setWizardTemplateId] = useState('default');
      const [wizardBusy, setWizardBusy] = useState(false);
      const [manageOpen, setManageOpen] = useState(false);
      const [manageTab, setManageTab] = useState('favorites');
      const [manageLoading, setManageLoading] = useState(false);
      const [manageGroups, setManageGroups] = useState([]);
      const [manageConfig, setManageConfig] = useState({ customGroups: [], overrides: {}, removedGroups: [], purgedGroups: [] });
      const [manageTools, setManageTools] = useState([]);
      const [manageFavorites, setManageFavorites] = useState([]);
      const [favorites, setFavorites] = useState([]);
      const [manageQuery, setManageQuery] = useState('');
      const [manageSelectedGroup, setManageSelectedGroup] = useState('');
      const [manageUngroupedOnly, setManageUngroupedOnly] = useState(false);
      const [newGroupName, setNewGroupName] = useState('');
      const [manageBusy, setManageBusy] = useState(false);
      const [manageNotice, setManageNotice] = useState(null);
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);
      const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
      const [deleteMemoryToo, setDeleteMemoryToo] = useState(false);
      const [deleteBusy, setDeleteBusy] = useState(false);
      const [deleteError, setDeleteError] = useState('');

      useEffect(() => {
        setDeleteDialogOpen(false);
        setDeleteMemoryToo(false);
      }, [workspaceId]);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const [capData, wsData, tplData] = await Promise.all([
              request('/capabilities'), request('/workspaces'), request('/templates'),
            ]);
            if (!alive) return;
            setCap(capData);
            setFavorites(capData.favorites || []);
            setTemplates(tplData.templates || []);
            setWorkspaces(wsData || []);
            const saved = localStorage.getItem(SELECTED_KEY);
            const nextId = (wsData || []).find((workspace) => workspace.id === saved)?.id
              ?? (wsData || [])[0]?.id;
            if (nextId) setWorkspaceId(nextId);
            else setLoading(false);
          } catch (err) {
            if (alive) { setError(String(err.message || err)); setLoading(false); }
          }
        })();
        return () => { alive = false; };
      }, []);

      useEffect(() => {
        if (!workspaceId) return;
        localStorage.setItem(SELECTED_KEY, workspaceId);
        let alive = true;
        setBusy(true);
        setNotice(null);
        (async () => {
          try {
            const [policyData, previewData] = await Promise.all([
              request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`),
              request(`/workspaces/${encodeURIComponent(workspaceId)}/preview`),
            ]);
            if (!alive) return;
            const nextPolicy = policyData.policy ?? policyData.draft;
            setManaged(Boolean(policyData.workspace?.managed));
            setPolicy(nextPolicy ? clonePolicy(nextPolicy) : null);
            setSavedPolicy(nextPolicy ? clonePolicy(nextPolicy) : null);
            setRevision(policyData.revision ?? null);
            setPreview(previewData);
            setTemplateId(nextPolicy?.template || 'default');
          } catch (err) {
            if (alive) setNotice({ type: 'error', text: String(err.message || err) });
          } finally {
            if (alive) { setBusy(false); setLoading(false); }
          }
        })();
        return () => { alive = false; };
      }, [workspaceId]);

      const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId), [workspaces, workspaceId]);
      const soulEnabled = policy?.identity?.soulEnabled === true;

      useEffect(() => {
        const text = typeof savedPolicy?.identity?.soul === 'string' ? savedPolicy.identity.soul : '';
        setSoulContent(text);
        setSoulOriginal(text);
        setSoulLoaded(Boolean(savedPolicy));
        setSoulStatus('');
      }, [workspaceId, savedPolicy]);

      const policyDirty = Boolean(policy && savedPolicy && JSON.stringify(policy) !== JSON.stringify(savedPolicy));
      const soulDirty = soulLoaded && soulContent !== soulOriginal;
      const dirty = !loading && (policyDirty || soulDirty);

      useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (event) => {
          event.preventDefault();
          event.returnValue = '';
        };
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          if (exitPrompt) {
            event.preventDefault();
            event.stopPropagation();
            setExitPrompt(false);
          } else if (dirty) {
            event.preventDefault();
            event.stopPropagation();
            setExitPrompt(true);
          }
        };
        const onClickCapture = (event) => {
          if (exitPrompt) return;
          const target = event.target;
          if (!(target instanceof Element)) return;
          const panel = target.closest('[data-shortcut-modal="settings"]');
          if (!panel) return;
          const button = target.closest('button');
          const headerClose = button
            && button.closest('[class*="header"]')
            && (String(button.className || '').split(/\s+/).some((name) => name.includes('close'))
              || ['关闭', 'Close'].includes((button.textContent || '').trim()));
          const nav = button && button.closest('[class*="nav"]');
          const navSwitch = Boolean(nav && panel.contains(nav)
            && !nav.closest('[class*="options"]')
            && button.getAttribute('aria-current') !== 'true');
          const mask = target.closest('[class*="mask"]');
          if (headerClose || navSwitch || (mask && !panel.contains(mask))) {
            event.preventDefault();
            event.stopImmediatePropagation();
            setExitPrompt(true);
          }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('click', onClickCapture, true);
        return () => {
          window.removeEventListener('beforeunload', onBeforeUnload);
          document.removeEventListener('keydown', onKeyDown, true);
          document.removeEventListener('click', onClickCapture, true);
        };
      }, [dirty, exitPrompt]);

      const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId), [templates, templateId]);
      const enabledGroups = (cap?.groups || []).flatMap((group) => {
        const ids = [];
        if (policy?.groups?.[group.id] === true) ids.push(group.name);
        for (const sub of group.subgroups || []) {
          if (policy?.groups?.[`${group.id}.${sub.id}`] === true) ids.push(`${group.name}/${sub.name}`);
        }
        return ids;
      });
      // Capability groups plus a synthetic "未分组" bucket for tools that are
      // registered but not assigned to any group.
      const displayGroups = useMemo(() => {
        const groups = [...(cap?.groups || [])];
        if (cap?.ungrouped?.length) {
          groups.push({
            id: 'ungrouped',
            name: '未分组',
            virtual: true,
            tools: cap.ungrouped.map((tool) => tool.name),
          });
        }
        return groups;
      }, [cap]);
      // Derive the count from the draft, not from the last saved preview, so every
      // checkbox click updates the counter immediately.
      const favoriteToolNames = useMemo(
        () => favorites
          .filter((item) => typeof item === 'string' && item.startsWith('tool:'))
          .map((item) => item.slice(5))
          .filter((name, index, list) => name && list.indexOf(name) === index),
        [favorites],
      );
      const toolStates = useMemo(() => {
        const rows = [];
        for (const group of displayGroups) {
          const groupOn = policy?.groups?.[group.id] === true;
          for (const tool of group.tools || []) {
            const on = groupOn ? !matchesAny(policy?.tools?.deny, tool) : matchesAny(policy?.tools?.allow, tool);
            rows.push({ name: tool, on });
          }
          for (const sub of group.subgroups || []) {
            const subOn = groupOn || policy?.groups?.[`${group.id}.${sub.id}`] === true;
            for (const tool of sub.tools || []) {
              const on = subOn ? !matchesAny(policy?.tools?.deny, tool) : matchesAny(policy?.tools?.allow, tool);
              rows.push({ name: tool, on });
            }
          }
        }
        for (const server of mcpServersOf(cap)) {
          for (const tool of server.tools || []) {
            rows.push({ name: tool.name, on: mcpToolOn(policy, server.id, tool.name) });
          }
        }
        const favoriteSet = new Set(favoriteToolNames);
        for (const row of rows) {
          if (favoriteSet.has(row.name) && policy?.favorites === true) {
            row.on = !matchesAny(policy?.tools?.deny, row.name);
          }
        }
        for (const tool of favoriteToolNames) {
          if (!rows.some((row) => row.name === tool)) {
            const on = policy?.favorites === true
              ? !matchesAny(policy?.tools?.deny, tool)
              : matchesAny(policy?.tools?.allow, tool);
            rows.push({ name: tool, on });
          }
        }
        return rows;
      }, [displayGroups, policy, favoriteToolNames]);
      const enabledToolStates = toolStates.filter((row) => row.on);
      const enabledCount = enabledToolStates.length;
      const totalCount = toolStates.length;
      // "全部开启" means every top-level group is on and nothing is denied.
      // Individual allow entries are irrelevant while every group is on.
      const allOn = Boolean(
        policy && cap && cap.groups.every((group) => policy.groups?.[group.id] === true)
        && (policy.tools?.deny?.length ?? 0) === 0,
      );

      const wizardToolStates = useMemo(() => {
        const rows = [];
        for (const group of cap?.groups || []) {
          const groupOn = wizardPolicy?.groups?.[group.id] === true;
          for (const tool of group.tools || []) {
            const on = groupOn ? !matchesAny(wizardPolicy?.tools?.deny, tool) : matchesAny(wizardPolicy?.tools?.allow, tool);
            rows.push({ name: tool, on });
          }
          for (const sub of group.subgroups || []) {
            const subOn = groupOn || wizardPolicy?.groups?.[`${group.id}.${sub.id}`] === true;
            for (const tool of sub.tools || []) {
              const on = subOn ? !matchesAny(wizardPolicy?.tools?.deny, tool) : matchesAny(wizardPolicy?.tools?.allow, tool);
              rows.push({ name: tool, on });
            }
          }
        }
        for (const server of mcpServersOf(cap)) {
          for (const tool of server.tools || []) {
            rows.push({ name: tool.name, on: mcpToolOn(wizardPolicy, server.id, tool.name) });
          }
        }
        return rows;
      }, [cap, wizardPolicy]);
      const wizardEnabledCount = wizardToolStates.filter((row) => row.on).length;
      const wizardEnabledGroups = (cap?.groups || []).flatMap((group) => {
        const ids = [];
        if (wizardPolicy?.groups?.[group.id] === true) ids.push(group.name);
        for (const sub of group.subgroups || []) {
          if (wizardPolicy?.groups?.[`${group.id}.${sub.id}`] === true) ids.push(`${group.name}/${sub.name}`);
        }
        return ids;
      });
      const manageGroupOptions = useMemo(
        () => groupOptionsFor(manageGroups, manageConfig.customGroups, manageConfig.removedGroups, manageConfig.purgedGroups),
        [manageGroups, manageConfig.customGroups, manageConfig.removedGroups, manageConfig.purgedGroups],
      );
      const manageGroupNames = useMemo(
        () => new Map(manageGroupOptions.map((option) => [option.key, option.name])),
        [manageGroupOptions],
      );
      const manageFavoriteSet = useMemo(() => new Set(manageFavorites), [manageFavorites]);
      const filteredManageTools = useMemo(() => {
        const query = manageQuery.trim().toLowerCase();
        if (!query) return manageTools;
        return manageTools.filter((tool) => (
          tool.name.toLowerCase().includes(query)
          || (tool.groupName || '').toLowerCase().includes(query)
          || (tool.description || '').toLowerCase().includes(query)
        ));
      }, [manageTools, manageQuery]);

      useEffect(() => {
        if (!manageOpen) return;
        if (manageGroupOptions.length === 0) {
          if (manageSelectedGroup) setManageSelectedGroup('');
          return;
        }
        if (!manageGroupOptions.some((option) => option.key === manageSelectedGroup)) {
          setManageSelectedGroup(manageGroupOptions[0].key);
        }
      }, [manageOpen, manageGroupOptions, manageSelectedGroup]);

      function patchPolicy(updater) {
        setPolicy((current) => {
          if (!current) return current;
          const next = clonePolicy(current);
          updater(next);
          return next;
        });
      }

      function setGroup(group, on) {
        patchPolicy((next) => {
          if (on) next.groups[group.id] = true;
          else delete next.groups[group.id];
          for (const sub of group.subgroups || []) delete next.groups[`${group.id}.${sub.id}`];
        });
      }
      function setSubgroup(group, sub, on) {
        patchPolicy((next) => {
          const key = `${group.id}.${sub.id}`;
          if (on) next.groups[key] = true;
          else delete next.groups[key];
        });
      }
      function setTool(tool, baseOn, checked) {
        patchPolicy((next) => {
          if (baseOn) {
            const denied = matchesAny(next.tools.deny, tool);
            if (checked && denied) next.tools.deny = next.tools.deny.filter((item) => item !== tool);
            if (!checked && !denied) next.tools.deny = [...next.tools.deny, tool];
          } else {
            const allowed = matchesAny(next.tools.allow, tool);
            if (checked && !allowed) next.tools.allow = [...next.tools.allow, tool];
            if (!checked && allowed) next.tools.allow = next.tools.allow.filter((item) => item !== tool);
          }
        });
      }
      function setMcpServer(server, on) {
        patchPolicy((next) => {
          const prefix = `mcp__${server}__`;
          const wildcard = mcpServerWildcard(server);
          next.tools.allow = (next.tools.allow || []).filter((item) => !item.startsWith(prefix));
          next.tools.deny = (next.tools.deny || []).filter((item) => item !== wildcard);
          if (on) next.tools.allow.push(wildcard);
          else next.tools.deny.push(wildcard);
        });
      }
      function setRule(key, checked) {
        patchPolicy((next) => { next.rules[key] = checked; });
      }
      function setMemory(key, value) {
        patchPolicy((next) => {
          next.memory[key] = value;
          if ((key === 'judge' && value === false) || (key === 'reviewMode' && value !== 'auto')) next.memory.theme = '';
        });
      }
      function setPersona(value) {
        patchPolicy((next) => { next.identity.persona = value; });
      }

      function setSoulEnabled(value) {
        patchPolicy((next) => { next.identity.soulEnabled = value; });
      }

      function updateSoul(value) {
        setSoulContent(value);
        patchPolicy((next) => { next.identity.soul = value; });
      }

      function setFavoriteGroup(on) {
        patchPolicy((next) => { next.favorites = on; });
      }

      function openWizard() {
        if (!policy) return;
        setWizardPolicy(clonePolicy(policy));
        setWizardTemplateId(policy.template || 'default');
        setWizardStep(1);
        setWizardBusy(false);
        setWizardOpen(true);
        setNotice(null);
        setTemplateMenuOpen(false);
        setEditingTemplate(false);
        setTemplateDraft(null);
        setSaveDialog(false);
        setCopyDialog(false);
      }

      function closeWizard() {
        if (wizardBusy) return;
        setWizardOpen(false);
        setWizardPolicy(null);
        setWizardStep(1);
      }

      function wizardPatch(updater) {
        setWizardPolicy((current) => {
          if (!current) return current;
          const next = clonePolicy(current);
          updater(next);
          return next;
        });
      }

      function wizardSetGroup(group, on) {
        wizardPatch((next) => {
          if (on) next.groups[group.id] = true;
          else delete next.groups[group.id];
          for (const sub of group.subgroups || []) delete next.groups[`${group.id}.${sub.id}`];
        });
      }

      function wizardSetAll(checked) {
        wizardPatch((next) => {
          next.groups = checked
            ? Object.fromEntries((cap?.groups || []).map((group) => [group.id, true]))
            : {};
          next.tools = {
            allow: checked
              ? [
                  ...(cap?.ungrouped || []).map((tool) => tool.name),
                  ...mcpServersOf(cap).map((server) => mcpServerWildcard(server.id)),
                ]
              : [],
            deny: [],
          };
        });
      }

      function wizardSetMcpServer(server, on) {
        wizardPatch((next) => {
          const prefix = `mcp__${server}__`;
          const wildcard = mcpServerWildcard(server);
          next.tools.allow = (next.tools.allow || []).filter((item) => !item.startsWith(prefix));
          next.tools.deny = (next.tools.deny || []).filter((item) => item !== wildcard);
          if (on) next.tools.allow.push(wildcard);
          else next.tools.deny.push(wildcard);
        });
      }
      function wizardSetSubgroup(group, sub, on) {
        wizardPatch((next) => {
          const key = `${group.id}.${sub.id}`;
          if (on) next.groups[key] = true;
          else delete next.groups[key];
        });
      }

      function wizardSetTool(tool, baseOn, checked) {
        wizardPatch((next) => {
          if (baseOn) {
            const denied = matchesAny(next.tools.deny, tool);
            if (checked && denied) next.tools.deny = next.tools.deny.filter((item) => item !== tool);
            if (!checked && !denied) next.tools.deny = [...next.tools.deny, tool];
          } else {
            const allowed = matchesAny(next.tools.allow, tool);
            if (checked && !allowed) next.tools.allow = [...next.tools.allow, tool];
            if (!checked && allowed) next.tools.allow = next.tools.allow.filter((item) => item !== tool);
          }
        });
      }

      function wizardSetRule(key, checked) {
        wizardPatch((next) => { next.rules[key] = checked; });
      }

      function wizardSetMemory(key, value) {
        wizardPatch((next) => {
          next.memory[key] = value;
          if ((key === 'judge' && value === false) || (key === 'reviewMode' && value !== 'auto')) next.memory.theme = '';
        });
      }

      function wizardSetPersona(value) {
        wizardPatch((next) => { next.identity.persona = value; });
      }

      function wizardApplyTemplate(id) {
        const template = templates.find((item) => item.id === id);
        if (!template) return;
        const switches = template.switches || {};
        setWizardTemplateId(id);
        wizardPatch((next) => {
          next.template = id;
          next.groups = { ...(switches.groups || {}) };
          next.tools = {
            allow: [...(switches.tools?.allow || [])],
            deny: [...(switches.tools?.deny || [])],
          };
        });
      }

      async function saveWizard() {
        if (!wizardPolicy) return;
        setWizardBusy(true);
        setNotice(null);
        try {
          const data = await request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`, {
            method: 'PUT',
            body: JSON.stringify({ policy: wizardPolicy, revision }),
          });
          setRevision(data.saved.revision);
          setManaged(true);
          const [policyData, previewData] = await Promise.all([
            request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`),
            request(`/workspaces/${encodeURIComponent(workspaceId)}/preview`),
          ]);
          setPolicy(clonePolicy(policyData.policy ?? policyData.draft));
          setSavedPolicy(clonePolicy(policyData.policy ?? policyData.draft));
          setPreview(previewData);
          setWorkspaces((rows) => rows.map((row) => row.id === workspaceId ? { ...row, managed: true } : row));
          setWizardOpen(false);
          setWizardPolicy(null);
          setWizardStep(1);
          setNotice({ type: 'ok', text: '向导已完成并保存；新会话会按该策略装配工具。' });
        } catch (err) {
          setNotice({ type: 'error', text: String(err.message || err) });
        } finally {
          setWizardBusy(false);
        }
      }

      async function openManage() {
        setManageOpen(true);
        setManageTab('favorites');
        setManageLoading(true);
        setManageQuery('');
        setManageSelectedGroup('');
        setManageUngroupedOnly(false);
        setNewGroupName('');
        setManageNotice(null);
        setWizardOpen(false);
        setTemplateMenuOpen(false);
        setSaveDialog(false);
        setCopyDialog(false);
        try {
          const [capData, favData] = await Promise.all([
            request('/capabilities'),
            request('/favorites'),
          ]);
          let config = capData.groupConfig;
          if (!config) config = (await request('/group-config')).config;
          setCap(capData);
          setManageGroups(capData.groups || []);
          setManageConfig(config || { customGroups: [], overrides: {}, removedGroups: [], purgedGroups: [] });
          setManageTools(collectToolRows(capData.groups || [], capData.ungrouped || [], capData.toolDescriptions || {}));
          setManageFavorites(favData.favorites || []);
          setFavorites(favData.favorites || []);
        } catch (err) {
          setManageNotice({ type: 'error', text: String(err.message || err) });
        } finally {
          setManageLoading(false);
        }
      }

      function closeManage() {
        if (manageBusy) return;
        setManageOpen(false);
        setManageNotice(null);
      }

      async function toggleManageFavorite(name) {
        const key = `tool:${name}`;
        const previous = manageFavorites;
        const next = previous.includes(key)
          ? previous.filter((item) => item !== key)
          : [...previous, key];
        setManageFavorites(next);
        setFavorites(next);
        try {
          await request('/favorites', {
            method: 'PUT',
            body: JSON.stringify({ favorites: next }),
          });
        } catch (err) {
          setManageFavorites(previous);
          setFavorites(previous);
          setManageNotice({ type: 'error', text: String(err.message || err) });
        }
      }

      async function clearManageFavorites() {
        if (manageFavorites.length === 0) return;
        if (!window.confirm('取消全部收藏？')) return;
        const previous = manageFavorites;
        setManageFavorites([]);
        setFavorites([]);
        try {
          await request('/favorites', {
            method: 'PUT',
            body: JSON.stringify({ favorites: [] }),
          });
        } catch (err) {
          setManageFavorites(previous);
          setFavorites(previous);
          setManageNotice({ type: 'error', text: String(err.message || err) });
        }
      }

      function setManageAssignment(tool, value) {
        setManageConfig((current) => {
          const overrides = { ...(current.overrides || {}) };
          if (value === '__default__') delete overrides[tool];
          else if (value === '__ungrouped__') overrides[tool] = '';
          else overrides[tool] = value;
          return { ...current, overrides };
        });
      }

      async function persistManageConfig(config, message) {
        setManageBusy(true);
        setManageNotice(null);
        try {
          const data = await request('/group-config', {
            method: 'PUT',
            body: JSON.stringify({
              customGroups: config.customGroups || [],
              overrides: config.overrides || {},
              removedGroups: config.removedGroups || [],
              purgedGroups: config.purgedGroups || [],
            }),
          });
          const capData = await request('/capabilities');
          setCap(capData);
          setManageGroups(capData.groups || []);
          setManageConfig(capData.groupConfig || data.config || { customGroups: [], overrides: {}, removedGroups: [], purgedGroups: [] });
          setManageTools(collectToolRows(capData.groups || [], capData.ungrouped || [], capData.toolDescriptions || {}));
          if (workspaceId) {
            const previewData = await request(`/workspaces/${encodeURIComponent(workspaceId)}/preview`);
            setPreview(previewData);
          }
          setManageNotice({ type: 'ok', text: message });
          return true;
        } catch (err) {
          setManageNotice({ type: 'error', text: String(err.message || err) });
          return false;
        } finally {
          setManageBusy(false);
        }
      }

      async function addManageGroup() {
        const name = newGroupName.trim();
        if (!name) return;
        const id = `custom-${Date.now().toString(36)}`;
        const next = {
          ...manageConfig,
          customGroups: [...(manageConfig.customGroups || []), { id, name, order: (manageConfig.customGroups?.length || 0) + 100 }],
        };
        setManageConfig(next);
        setNewGroupName('');
        setManageSelectedGroup(id);
        await persistManageConfig(next, `新组「${name}」已创建并保存。`);
      }

      async function removeManageGroup(id) {
        if (!id) return;
        const group = manageGroupOptions.find((item) => item.key === id)
          || (manageConfig.customGroups || []).find((item) => item.id === id);
        const name = group?.name || group?.id || id;
        if (!window.confirm(`删除分组「${name}」？组内工具会进入未分组；收藏不受影响。`)) return;
        const overrides = { ...(manageConfig.overrides || {}) };
        for (const [tool, target] of Object.entries(overrides)) {
          if (target === id) overrides[tool] = '';
        }
        const removedGroups = [...new Set([...(manageConfig.removedGroups || []), id])];
        const next = { ...manageConfig, overrides, removedGroups };
        setManageConfig(next);
        if (manageSelectedGroup === id) setManageSelectedGroup('');
        await persistManageConfig(next, `分组「${name}」已删除；组内工具现在位于未分组。`);
      }

      async function restoreManageGroup(id) {
        const next = {
          ...manageConfig,
          removedGroups: (manageConfig.removedGroups || []).filter((item) => item !== id),
        };
        setManageConfig(next);
        await persistManageConfig(next, `分组「${id}」已恢复。`);
      }

      async function purgeManageGroup(id) {
        if (!id) return;
        const group = (manageConfig.customGroups || []).find((item) => item.id === id);
        const name = manageGroupNames.get(id) || group?.name || id;
        if (!window.confirm(`永久删除分组「${name}」？此操作无法从本页面恢复，但组内工具会进入未分组。`)) return;
        const overrides = { ...(manageConfig.overrides || {}) };
        for (const [tool, target] of Object.entries(overrides)) {
          if (target === id) overrides[tool] = '';
        }
        const next = {
          ...manageConfig,
          customGroups: (manageConfig.customGroups || []).filter((item) => item.id !== id),
          overrides,
          removedGroups: (manageConfig.removedGroups || []).filter((item) => item !== id),
          purgedGroups: [...new Set([...(manageConfig.purgedGroups || []), id])],
        };
        setManageConfig(next);
        if (manageSelectedGroup === id) setManageSelectedGroup('');
        await persistManageConfig(next, `分组「${name}」已永久删除；组内工具现在位于未分组。`);
      }

      async function saveManageGroups() {
        await persistManageConfig(manageConfig, '分组已保存；同一工具只会属于一个能力组，收藏保持独立。新会话/下一次装配生效。');
      }

      function toggleAll() {
        if (!policy || !cap) return;
        const nextOn = !allOn;
        patchPolicy((next) => {
          next.groups = nextOn
            ? Object.fromEntries(cap.groups.map((group) => [group.id, true]))
            : {};
          next.favorites = nextOn;
          next.tools.allow = nextOn
            ? [
                ...(cap.ungrouped || []).map((tool) => tool.name),
                ...mcpServersOf(cap).map((server) => mcpServerWildcard(server.id)),
              ]
            : [];
          next.tools.deny = [];
        });
        setNotice({
          type: 'ok',
          text: nextOn
            ? '已把能力组全部开启（草稿），点「全部保存并应用」后生效。'
            : '已把能力组全部关闭（草稿），点「全部保存并应用」后生效。',
        });
      }

      async function saveSoulOnly() {
        const ok = await save();
        setSoulStatus(ok ? '已保存' : '');
        return ok;
      }

      async function save() {
        if (!policy || busy || soulBusy) return false;
        setBusy(true);
        setNotice(null);
        setSoulStatus('');
        try {
          const data = await request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`, {
            method: 'PUT',
            body: JSON.stringify({ policy, revision }),
          });
          setRevision(data.saved.revision);
          setManaged(true);
          const [policyData, previewData] = await Promise.all([
            request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`),
            request(`/workspaces/${encodeURIComponent(workspaceId)}/preview`),
          ]);
          const fresh = policyData.policy ?? policyData.draft;
          setPolicy(fresh ? clonePolicy(fresh) : null);
          setSavedPolicy(fresh ? clonePolicy(fresh) : null);
          setPreview(previewData);
          setWorkspaces((rows) => rows.map((row) => row.id === workspaceId ? { ...row, managed: true } : row));
          setSoulOriginal(soulContent);
          setSoulLoaded(true);
          setSoulStatus('已保存');
          setNotice({ type: 'ok', text: '全部设置已保存。新会话或下一次请求生效。' });
          return true;
        } catch (err) {
          setNotice({ type: 'error', text: String(err.message || err) });
          return false;
        } finally {
          setBusy(false);
        }
      }

      async function applyTemplate() {
        setBusy(true);
        setNotice(null);
        try {
          await request(`/workspaces/${encodeURIComponent(workspaceId)}/apply-template`, {
            method: 'POST',
            body: JSON.stringify({ templateId }),
          });
          const [policyData, previewData] = await Promise.all([
            request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`),
            request(`/workspaces/${encodeURIComponent(workspaceId)}/preview`),
          ]);
          setPolicy(clonePolicy(policyData.policy ?? policyData.draft));
          setSavedPolicy(clonePolicy(policyData.policy ?? policyData.draft));
          setRevision(policyData.revision ?? null);
          setManaged(true);
          setPreview(previewData);
          setNotice({ type: 'ok', text: `已应用模板 ${templateId}。` });
        } catch (err) {
          setNotice({ type: 'error', text: String(err.message || err) });
        } finally {
          setBusy(false);
        }
      }

      function loadTemplateIntoDraft(id) {
        const base = templates.find((template) => template.id === id);
        if (!base) return;
        setTemplateId(id);
        setTemplateIsNew(false);
        setTemplateDraft(templateToPolicy(base));
        setTemplateName(base.name || '');
        setTemplateDescription(base.description || '');
      }

      function openTemplateEditor() {
        const base = templates.find((template) => template.id === templateId) || templates[0];
        if (!base) return;
        setEditingTemplate(true);
        setSaveDialog(false);
        setTemplateMenuOpen(false);
        setNotice(null);
        loadTemplateIntoDraft(base.id);
      }

      function openNewTemplate() {
        setEditingTemplate(true);
        setTemplateIsNew(true);
        setTemplateId('');
        setTemplateDraft(templateToPolicy({ id: '', switches: { groups: {}, tools: { allow: [], deny: [] } } }));
        setTemplateName(`新模板 ${templates.length + 1}`);
        setTemplateDescription('');
        setSaveDialog(false);
        setTemplateMenuOpen(false);
        setNotice(null);
      }

      function closeTemplateEditor() {
        setEditingTemplate(false);
        setTemplateIsNew(false);
        setSaveDialog(false);
        setCopyDialog(false);
        setTemplateMenuOpen(false);
        setTemplateDraft(null);
      }

      function handleTemplateSelect(id) {
        setTemplateMenuOpen(false);
        if (editingTemplate) loadTemplateIntoDraft(id);
        else setTemplateId(id);
      }

      function patchTemplate(updater) {
        setTemplateDraft((current) => {
          if (!current) return current;
          const next = clonePolicy(current);
          updater(next);
          return next;
        });
      }

      function templateSetGroup(group, on) {
        patchTemplate((next) => {
          if (on) next.groups[group.id] = true;
          else delete next.groups[group.id];
          for (const sub of group.subgroups || []) delete next.groups[`${group.id}.${sub.id}`];
        });
      }

      function templateSetSubgroup(group, sub, on) {
        patchTemplate((next) => {
          const key = `${group.id}.${sub.id}`;
          if (on) next.groups[key] = true;
          else delete next.groups[key];
        });
      }

      function templateSetTool(tool, baseOn, checked) {
        patchTemplate((next) => {
          if (baseOn) {
            const denied = matchesAny(next.tools.deny, tool);
            if (checked && denied) next.tools.deny = next.tools.deny.filter((item) => item !== tool);
            if (!checked && !denied) next.tools.deny = [...next.tools.deny, tool];
          } else {
            const allowed = matchesAny(next.tools.allow, tool);
            if (checked && !allowed) next.tools.allow = [...next.tools.allow, tool];
            if (!checked && allowed) next.tools.allow = next.tools.allow.filter((item) => item !== tool);
          }
        });
      }

      function nextTemplateId() {
        let id = `custom-${Date.now().toString(36)}`;
        while (templates.some((template) => template.id === id)) id += '-x';
        return id;
      }

      function nextTemplateOrder() {
        return Math.max(0, ...templates.map((template) => Number(template.order) || 0)) + 1;
      }

      async function commitTemplate(mode, nameOverride) {
        if (!templateDraft) return;
        const base = templates.find((template) => template.id === templateId);
        if (mode === 'overwrite' && !base) return;
        const name = (nameOverride ?? templateName).trim() || (base?.name ?? '新模板');
        const updated = templateFromPolicy(templateDraft, {
          id: mode === 'overwrite' ? base.id : nextTemplateId(),
          name,
          description: templateDescription.trim(),
          order: mode === 'overwrite' ? (base.order ?? 0) : nextTemplateOrder(),
        });
        const next = mode === 'overwrite'
          ? templates.map((template) => template.id === base.id ? updated : template)
          : [...templates, updated];
        setSavingTemplate(true);
        setNotice(null);
        try {
          const data = await request('/templates', {
            method: 'PUT',
            body: JSON.stringify({ templates: next }),
          });
          setTemplates(data.templates || next);
          setTemplateId(updated.id);
          setTemplateIsNew(false);
          setEditingTemplate(false);
          setSaveDialog(false);
          setCopyDialog(false);
          setTemplateDraft(null);
          setNotice({
            type: 'ok',
            text: mode === 'overwrite'
              ? '已覆盖原模板；新建工作区默认会使用最新的 default 模板。'
              : '已另存为新模板；可在模板下拉框中选用。',
          });
        } catch (err) {
          setNotice({ type: 'error', text: String(err.message || err) });
        } finally {
          setSavingTemplate(false);
        }
      }

      function saveTemplate() {
        if (templateIsNew) {
          commitTemplate('new', templateName);
          return;
        }
        setSaveDialog(true);
      }

      function saveTemplateAsCopy() {
        const original = templates.find((template) => template.id === templateId);
        setSaveDialog(false);
        setCopyName(`${original?.name || templateName || '模板'} 副本`);
        setCopyDialog(true);
      }

      function confirmTemplateCopy() {
        const name = copyName.trim();
        if (!name) return;
        commitTemplate('copy', name);
      }

      async function deleteTemplate() {
        if (templateIsNew || !templateId || templateId === 'default') return;
        const target = templates.find((template) => template.id === templateId);
        if (!target) return;
        if (!window.confirm(`删除模板「${target.name}」？不会影响已经应用该模板的工作区策略。`)) return;
        setSavingTemplate(true);
        setNotice(null);
        try {
          const data = await request(`/templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' });
          const list = data.templates || [];
          setTemplates(list);
          setTemplateId(list.some((template) => template.id === 'default') ? 'default' : (list[0]?.id || ''));
          setEditingTemplate(false);
          setTemplateDraft(null);
          setSaveDialog(false);
          setCopyDialog(false);
          setNotice({ type: 'ok', text: '模板已删除；默认模板始终保留。' });
        } catch (err) {
          setNotice({ type: 'error', text: String(err.message || err) });
        } finally {
          setSavingTemplate(false);
        }
      }

      function deletePolicy() {
        setDeleteMemoryToo(false);
        setDeleteError('');
        setDeleteDialogOpen(true);
      }

      async function confirmDeletePolicy() {
        if (deleteBusy || !managed) return;
        setDeleteBusy(true);
        setDeleteError('');
        setNotice(null);
        try {
          const query = deleteMemoryToo ? '?deleteMemory=1' : '';
          await request(`/workspaces/${encodeURIComponent(workspaceId)}/policy${query}`, {
            method: 'DELETE',
          });
          setDeleteDialogOpen(false);
          setManaged(false);
          setRevision(null);
          const [policyData, previewData] = await Promise.all([
            request(`/workspaces/${encodeURIComponent(workspaceId)}/policy`),
            request(`/workspaces/${encodeURIComponent(workspaceId)}/preview`),
          ]);
          setPolicy(policyData.draft ? clonePolicy(policyData.draft) : null);
          setSavedPolicy(policyData.draft ? clonePolicy(policyData.draft) : null);
          setPreview(previewData);
          setWorkspaces((rows) => rows.map((row) => row.id === workspaceId ? { ...row, managed: false } : row));
          setNotice({
            type: 'ok',
            text: deleteMemoryToo
              ? '已删除策略和记忆库；该工作区回到未托管（全开）。'
              : '已删除策略；记忆库保留，该工作区回到未托管（全开）。',
          });
        } catch (err) {
          setDeleteError(String(err.message || err));
        } finally {
          setDeleteBusy(false);
        }
      }

      function renderWizardStep() {
        if (!wizardPolicy) return null;
        if (wizardStep === 1) {
          return h('div', null,
            h('p', { style: { ...styles.muted, marginTop: 0 } }, '选一个模板作为起点。模板只切换能力组和单工具，规则、SOUL、记忆保留当前值。'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 } },
              templates.map((template) => h('button', {
                key: template.id,
                type: 'button',
                onClick: () => wizardApplyTemplate(template.id),
                style: {
                  ...styles.templateOption,
                  ...(wizardTemplateId === template.id ? styles.templateOptionActive : {}),
                },
              },
                h('div', { style: styles.templateOptionName }, template.name),
                h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.4 } }, template.description || '（无描述）')))));
        }
        if (wizardStep === 2) {
          return h('div', null,
            h('p', { style: { ...styles.muted, marginTop: 0 } }, '按需开启能力组；每个工具下方有功能说明，也可以单独调整工具。'),
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 8 } },
              h(Button, { onClick: () => wizardSetAll(true) }, '一键全选'),
              h(Button, { onClick: () => wizardSetAll(false) }, '取消全选')),
            (cap?.groups || []).map((group) => h(GroupCard, {
              key: `wizard-${group.id}`,
              group,
              policy: wizardPolicy,
              descriptions: cap?.toolDescriptions || {},
              onGroup: wizardSetGroup,
              onSubgroup: wizardSetSubgroup,
              onTool: wizardSetTool,
            })),
            mcpServersOf(cap).map((server) => h(McpGroupCard, {
              key: `wizard-mcp-${server.id}`,
              server,
              policy: wizardPolicy,
              descriptions: cap?.toolDescriptions || {},
              onServer: wizardSetMcpServer,
              onTool: wizardSetTool,
            })),
            cap?.ungrouped?.length > 0 && h(GroupCard, {
              key: 'wizard-ungrouped',
              group: { id: 'ungrouped', name: '未分组', virtual: true, tools: cap.ungrouped.map((tool) => tool.name) },
              policy: wizardPolicy,
              descriptions: cap?.toolDescriptions || {},
              onGroup: wizardSetGroup,
              onSubgroup: wizardSetSubgroup,
              onTool: wizardSetTool,
            }));
        }
        if (wizardStep === 3) {
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            h(Checkbox, {
              checked: wizardPolicy.rules?.global !== false,
              onChange: (checked) => wizardSetRule('global', checked),
              label: '全局 RULE（跨工作区；关闭时同时隐藏 global_rule 工具）',
            }),
            h('p', { style: { ...styles.muted, margin: 0 } }, '工作区 SOUL 在创建后于「工作区扩展 → 规则、身份与记忆」中编辑。'),
            h('label', { style: { display: 'block', marginTop: 0 } },
              h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆审核模式'),
              h('select', {
                value: wizardPolicy.memory?.reviewMode || (wizardPolicy.memory?.judge === false ? 'off' : 'auto'),
                onChange: (event) => wizardSetMemory('reviewMode', event.target.value),
                style: { ...styles.select, width: '100%', maxWidth: '100%' },
              },
                h('option', { value: 'auto' }, '自动 judge：主题匹配才入库'),
                h('option', { value: 'off' }, '关闭 judge：全部直接入库'),
                h('option', { value: 'manual' }, '手动审批：全部进待审区'))),
            h('p', { style: { ...styles.muted, margin: 0 } }, '自动模式需要主题；关闭或手动模式默认没有主题，也不会再询问是否设置主题。'),
            (wizardPolicy.memory?.reviewMode || (wizardPolicy.memory?.judge === false ? 'off' : 'auto')) === 'auto' && h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
              h('label', { style: { flex: '1 1 220px', minWidth: 0 } },
                h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆主题'),
                h('input', {
                  value: wizardPolicy.memory?.theme || '',
                  placeholder: '例如：DSH 插件开发',
                  onChange: (event) => wizardSetMemory('theme', event.target.value),
                  style: styles.input,
                }))),
            h('label', { style: { ...styles.toolRow, padding: '5px 0', marginTop: 4 } },
              h('input', {
                type: 'checkbox', checked: wizardPolicy.memory?.enabled === true,
                onChange: (event) => wizardSetMemory('enabled', event.target.checked),
                style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
              }),
              h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                h('span', { style: { fontSize: 12 } }, '启用记忆（本工作区）'),
                h('span', { style: { ...styles.muted, fontSize: 11 } }, '默认关闭；启用后可填写主题/项目并开始记忆'))),
            h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 } },
              h('label', { style: { flex: '1 1 260px', minWidth: 0 } },
                h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, 'judge 模型'),
                h(ModelSelect, {
                  value: wizardPolicy.memory?.judgeModel || '',
                  onChange: (value) => wizardSetMemory('judgeModel', value),
                  emptyLabel: '默认（DSH 代理默认模型）',
                })),
              h('label', { style: { ...styles.toolRow, flex: '0 0 auto', padding: '5px 0' } },
                h('input', {
                  type: 'checkbox', checked: wizardPolicy.memory?.soulAiWritable === true,
                  onChange: (event) => wizardSetMemory('soulAiWritable', event.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
                }),
                h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('span', { style: { fontSize: 12 } }, '允许 AI 写 SOUL'),
                  h('span', { style: { ...styles.muted, fontSize: 11 } }, '默认关；用户始终可编辑')))));
        }
        const template = templates.find((item) => item.id === wizardTemplateId);
        return h('div', null,
          h('p', { style: { ...styles.muted, marginTop: 0 } }, '确认后写入该工作区的 policy.json；当前已打开的会话仍受旧策略影响，新会话按新策略装配。'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 14px', fontSize: 13, lineHeight: 1.5 } },
            h('span', { style: styles.muted }, '工作区'), h('span', null, `${workspace?.title || ''}（${workspace?.path || ''}）`),
            h('span', { style: styles.muted }, '起始模板'), h('span', null, template?.name || wizardTemplateId || '（无）'),
            h('span', { style: styles.muted }, '已启用工具'), h('span', null, `${wizardEnabledCount} / ${wizardToolStates.length}`),
            h('span', { style: styles.muted }, '能力组'), h('span', null, wizardEnabledGroups.length ? wizardEnabledGroups.join('、') : '（无）'),
            h('span', { style: styles.muted }, '全局 RULE（跨工作区）'), h('span', null, wizardPolicy.rules?.global === false ? '关闭' : '开启'),
            h('span', { style: styles.muted }, '记忆主题'), h('span', null, (wizardPolicy.memory?.reviewMode || (wizardPolicy.memory?.judge === false ? 'off' : 'auto')) !== 'auto' ? '（未启用）' : (wizardPolicy.memory?.theme || '（空）'))));
      }

      function renderManageTabButton(key, label) {
        const active = manageTab === key;
        return h('button', {
          type: 'button',
          onClick: () => setManageTab(key),
          style: { ...styles.manageTab, ...(active ? styles.manageTabActive : {}) },
        },
          h('span', null, label),
          h('span', {
            style: {
              display: 'block',
              height: 2,
              borderRadius: 1,
              marginTop: 5,
              background: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l2)',
            },
          }));
      }

      function renderManageFavorites() {
        return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
            h('input', {
              value: manageQuery,
              onChange: (event) => setManageQuery(event.target.value),
              placeholder: '搜索工具 / 分组 / 描述',
              style: { ...styles.input, flex: 1 },
            }),
            h('span', { style: styles.muted }, `${filteredManageTools.length} 个工具`),
            h(Button, { onClick: clearManageFavorites, disabled: manageFavorites.length === 0, style: styles.buttonDanger }, '全部取消收藏')),
          h('p', { style: { ...styles.muted, margin: '8px 0 0' } }, '收藏是全局快捷入口，不会自动开启工具，也不改变分组。'),
          h('div', { style: styles.manageList },
            h('div', { style: styles.manageGrid },
              filteredManageTools.map((tool) => {
                const key = `tool:${tool.name}`;
                const favorite = manageFavoriteSet.has(key);
                return h('div', { key: tool.name, style: styles.manageToolCard },
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: styles.manageToolName }, tool.name),
                    h('div', { style: styles.manageDesc }, `${tool.groupName} · ${tool.description || '（无描述）'}`)),
                  h(Button, {
                    onClick: () => toggleManageFavorite(tool.name),
                    style: favorite ? styles.buttonAccent : styles.button,
                  }, favorite ? '★ 已收藏' : '☆ 收藏'));
              }))));
      }

      function renderManageGroups() {
        const selected = manageGroupOptions.find((option) => option.key === manageSelectedGroup);
        const localGroupKey = (tool) => {
          const override = manageConfig.overrides?.[tool.name];
          return override === undefined ? tool.groupKey : override;
        };
        const members = filteredManageTools.filter((tool) => localGroupKey(tool) === manageSelectedGroup);
        const available = filteredManageTools.filter((tool) => localGroupKey(tool) !== manageSelectedGroup
          && (!manageUngroupedOnly || localGroupKey(tool) === ''));
        const removedGroups = manageConfig.removedGroups || [];
        const removedGroupName = (id) => (manageConfig.customGroups || []).find((group) => group.id === id)?.name || id;
        const currentGroup = (tool) => {
          const override = manageConfig.overrides?.[tool.name];
          if (override === undefined) return tool.groupName;
          if (override === '') return '未分组';
          return manageGroupNames.get(override) || override;
        };
        return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
          h('p', { style: { ...styles.muted, marginTop: 8 } }, '先选定一个组；添加会把工具从原组移出，移除会变成未分组。收藏不受影响。删除组后，组内工具进入未分组，可在下方恢复。'),
          h('label', { style: { display: 'block', marginTop: 6 } },
            h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '目标组'),
            h('select', {
              value: manageSelectedGroup,
              onChange: (event) => setManageSelectedGroup(event.target.value),
              style: { ...styles.select, width: '100%', maxWidth: '100%' },
            },
              manageGroupOptions.map((option) => h('option', { key: option.key, value: option.key }, option.name)))),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' } },
            h(Button, {
              onClick: () => removeManageGroup(manageSelectedGroup),
              disabled: manageBusy || !manageSelectedGroup,
              style: styles.buttonDanger,
              title: '删除当前组；组内工具进入未分组',
            }, '删除当前组'),
            removedGroups.length > 0
              ? h('details', { style: { flex: '1 1 260px' } },
                h('summary', { style: { ...styles.muted, cursor: 'pointer' } }, `已删除组（${removedGroups.length}）`),
                h('div', { style: { ...styles.toolList, marginTop: 4 } },
                  removedGroups.map((id) => h('div', {
                    key: id,
                    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' },
                  },
                  h('span', { style: { ...styles.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, removedGroupName(id)),
                  h(Button, { onClick: () => restoreManageGroup(id), disabled: manageBusy }, '恢复'),
                  h(Button, { onClick: () => purgeManageGroup(id), disabled: manageBusy, style: styles.buttonDanger }, '永久删除')))))
              : null),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
            h('input', {
              value: manageQuery,
              onChange: (event) => setManageQuery(event.target.value),
              placeholder: '搜索工具 / 当前分组 / 描述',
              style: { ...styles.input, flex: 1 },
            }),
            h('span', { style: styles.muted }, `${members.length} 组内 / ${available.length} 可添加`)),
          h('h4', { style: styles.manageSubhead }, `组内工具（${members.length}）`),
          members.length === 0
            ? h('p', { style: styles.muted }, '这个组还没有工具；从下方“可添加工具”里加入。')
            : h('div', { style: styles.manageList },
              h('div', { style: styles.manageGrid },
                members.map((tool) => h('div', { key: tool.name, style: styles.manageToolCard },
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: styles.manageToolName }, tool.name),
                    h('div', { style: styles.manageDesc }, tool.description || '（无描述）')),
                  h(Button, {
                    onClick: () => setManageAssignment(tool.name, '__ungrouped__'),
                    style: styles.buttonDanger,
                  }, '移除'))))),
          manageSelectedGroup !== '' && h(Checkbox, {
            checked: manageUngroupedOnly,
            onChange: setManageUngroupedOnly,
            label: '只看未分组工具',
          }),
          h('h4', { style: styles.manageSubhead }, `可添加工具（${available.length}）`),
          available.length === 0
            ? h('p', { style: styles.muted }, '所有工具都已在这个组或搜索结果为空。')
            : h('div', { style: styles.manageList },
              h('div', { style: styles.manageGrid },
                available.map((tool) => h('div', { key: tool.name, style: styles.manageToolCard },
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: styles.manageToolName }, tool.name),
                    h('div', { style: styles.manageDesc }, `当前：${currentGroup(tool)} · ${tool.description || '（无描述）'}`)),
                  h(Button, {
                    onClick: () => setManageAssignment(tool.name, manageSelectedGroup),
                  }, '添加'))))),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 10 } },
            h(Button, { onClick: saveManageGroups, disabled: manageBusy || !selected, style: styles.buttonAccent }, manageBusy ? '保存中…' : '保存分组')));
      }

      function renderManageNewGroup() {
        const hidden = new Set([...(manageConfig.removedGroups || []), ...(manageConfig.purgedGroups || [])]);
        const activeGroups = (manageGroups || []).filter((group) => !hidden.has(group.id));
        return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
          h('p', { style: { ...styles.muted, marginTop: 8 } }, '新建/删除会自动保存；删除任意组后，组内工具进入未分组，可在“分组”页恢复。'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 } },
            h('input', {
              value: newGroupName,
              onChange: (event) => setNewGroupName(event.target.value),
              placeholder: '新组名称',
              style: { ...styles.input, flex: '1 1 220px' },
            }),
            h(Button, { onClick: addManageGroup, disabled: manageBusy || !newGroupName.trim() }, '新建组')),
          h('h4', { style: styles.manageSubhead }, `现有组（${activeGroups.length}）`),
          activeGroups.length === 0
            ? h('p', { style: styles.muted }, '还没有分组。')
            : h('div', { style: styles.manageGrid },
              activeGroups.map((group) => h('div', { key: group.id, style: styles.manageToolCard },
                h('div', { style: { minWidth: 0 } },
                  h('div', { style: styles.manageToolName }, group.name),
                  h('div', { style: styles.manageDesc }, group.id)),
                h(Button, { onClick: () => removeManageGroup(group.id), disabled: manageBusy, style: styles.buttonDanger }, '删除')))),
          h('p', { style: { ...styles.muted, marginTop: 10 } }, '删除核心组或运行时组后，工具不会消失，只会进入未分组。'));
      }

      function renderFavoriteGroupCard() {
        const groupOn = policy?.favorites === true;
        const toolChecked = (tool) => groupOn
          ? !matchesAny(policy?.tools?.deny, tool)
          : matchesAny(policy?.tools?.allow, tool);
        return h('div', null,
          h('h3', { style: styles.subTitle }, '收藏组'),
          h('div', { style: styles.groupRow },
            h('input', {
              type: 'checkbox',
              checked: groupOn,
              disabled: !policy,
              onChange: (event) => setFavoriteGroup(event.target.checked),
              style: { accentColor: 'var(--dsw-alias-brand-primary)' },
            }),
            h('span', { style: styles.groupName }, '收藏组'),
            h('span', { style: styles.count }, `${groupOn ? '整组开启' : '关闭'} · ${favoriteToolNames.length} 工具`)),
          h('p', { style: { ...styles.muted, margin: '2px 0 4px' } }, '收藏组是独立叠加层：工具可以同时属于一个普通能力组和收藏组，不参与工具组间冲突。'),
          favoriteToolNames.length === 0
            ? h('p', { style: styles.muted }, '还没有收藏工具；在「管理分组」→ 收藏里添加。')
            : h('details', { style: { marginLeft: 24 } },
              h('summary', { style: { ...styles.muted, cursor: 'pointer', padding: '2px 0' } }, '查看/调整收藏的单个工具'),
              h('div', { style: styles.toolList },
                favoriteToolNames.map((tool) => h(ToolRow, {
                  key: tool,
                  tool,
                  description: cap?.toolDescriptions?.[tool],
                  checked: toolChecked(tool),
                  onChange: (checked) => setTool(tool, groupOn, checked),
                })))));
      }

      function scrollToSection(id) {
        const element = document.getElementById(id);
        if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      if (loading) return h('div', { className: 'workspace-scope-page', style: styles.page }, h('p', { style: styles.muted }, '加载工作区扩展设置…'));
      if (error) {
        return h('div', { className: 'workspace-scope-page', style: styles.page },
          h('h1', { style: styles.h1 }, '工作区扩展'),
          h('p', { style: { ...styles.muted, color: 'var(--dsw-alias-state-error-primary)' } }, error),
          h('p', { style: styles.muted }, 'Host API 不可用？确认 workspace-scope 插件已启用且已重启 DSH。'));
      }

      return h('div', { className: 'workspace-scope-page', style: styles.page },
        h('nav', { style: styles.anchorNav },
          h('span', { style: { ...styles.muted, marginRight: 4 } }, '跳转'),
          [['ws-scope-template', '模板'], ['ws-scope-tools', '工具组'], ['ws-scope-mcp', 'MCP'], ['ws-scope-rules', '规则 SOUL'], ['ws-scope-memory', '记忆'], ['ws-scope-preview', '预览']].map(([id, label]) => h('button', {
            key: id, type: 'button', onClick: () => scrollToSection(id), style: styles.anchorButton,
          }, label))),
        h('section', { id: 'ws-scope-top', style: { ...styles.card, marginBottom: 14 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
            h('h1', { style: styles.h1 }, '工作区扩展'),
            h('span', { style: { ...styles.status, color: managed ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' } },
              managed ? '已托管' : '未托管（全开）')),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 } },
            h(Button, { onClick: openWizard, disabled: busy || !policy, style: styles.buttonAccent, title: '按步骤选择模板、能力和规则' }, '配置向导'),
            h(Button, { onClick: save, disabled: busy || soulBusy || !policy, style: styles.buttonAccent }, busy ? '保存中…' : '全部保存并应用'),
            h(Button, { onClick: onOpenQuarantine, disabled: busy || !managed, style: styles.button, title: '查看待审记忆与暂存记忆' }, '记忆管理'),
            h(Button, { onClick: deletePolicy, disabled: busy || deleteBusy || !managed, style: styles.buttonDanger, title: '删除策略文件；可选择是否同时删除记忆库' }, '删除策略')),
          h('div', { style: styles.toolbar },
            h('span', { style: styles.muted }, '工作区'),
            h('select', {
              value: workspaceId, onChange: (event) => setWorkspaceId(event.target.value), style: styles.select,
            }, workspaces.map((item) => h('option', { key: item.id, value: item.id }, `${item.title} — ${item.path}`))),
            workspace && h('span', { style: styles.code }, workspace.path)),
          h('p', { style: { ...styles.muted, margin: '6px 0 0' } }, '策略变更只能在本页确认并保存；AI 不能直接修改策略文件。'),
          notice && h('div', { style: { ...styles.banner, color: notice.type === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } }, notice.text),
          managed && enabledGroups.length === 0 && h('div', { style: { ...styles.banner, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            '当前是空白策略（全部关闭）。可以按向导逐步选择模板和能力。',
            h(Button, { onClick: openWizard, disabled: busy || !policy }, '开始向导'))),

        h('div', { style: styles.grid },
          h('div', null,
            h('section', { id: 'ws-scope-template', style: styles.card },
              h('h2', { style: styles.cardTitle }, '模板'),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { style: styles.templatePicker },
                  h('button', {
                    type: 'button',
                    onClick: () => setTemplateMenuOpen((open) => !open),
                    style: styles.templateButton,
                    'aria-haspopup': 'listbox',
                    'aria-expanded': templateMenuOpen,
                  },
                    h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                      templateIsNew ? '新模板（未保存）' : (selectedTemplate?.name || '选择模板')),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, templateMenuOpen ? '▴' : '▾')),
                  templateMenuOpen && h('div', {
                    style: { position: 'fixed', inset: 0, zIndex: 40 },
                    onClick: () => setTemplateMenuOpen(false),
                  }),
                  templateMenuOpen && h('div', { style: styles.templateMenu, role: 'listbox' },
                    templates.map((template) => h('button', {
                      key: template.id,
                      type: 'button',
                      role: 'option',
                      onClick: () => handleTemplateSelect(template.id),
                      style: {
                        ...styles.templateMenuItem,
                        ...(template.id === templateId ? styles.templateMenuItemActive : {}),
                      },
                    },
                      h('span', { style: { display: 'block', fontSize: 13 } }, template.name),
                      h('span', { style: styles.templateMenuDesc }, template.description || '（无描述）'))))),
                h('p', { style: { ...styles.muted, margin: 0, lineHeight: 1.5 } },
                  templateIsNew
                    ? (templateDescription || '新模板尚未保存')
                    : (selectedTemplate?.description || '（无描述）')),
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                  h(Button, { onClick: applyTemplate, disabled: busy || !workspaceId || templateIsNew || !templateId }, busy ? '应用…' : '应用模板'),
                  h(Button, { onClick: openTemplateEditor, disabled: busy || templates.length === 0 }, '编辑模板'),
                  h(Button, { onClick: openNewTemplate, disabled: busy }, '新建模板'),
                  h(Button, {
                    onClick: deleteTemplate,
                    disabled: busy || templateIsNew || !templateId || templateId === 'default',
                    style: styles.buttonDanger,
                    title: templateId === 'default' ? '默认模板只能修改，不能删除' : '删除当前模板',
                  }, '删除当前模板'))),
              h('p', { style: { ...styles.muted, marginTop: 8 } }, '模板只切换组与工具开关，不改动 SOUL；应用后会立即写入策略。新建工作区默认使用 default 模板。')),

            editingTemplate && templateDraft && h('section', { style: { ...styles.card, marginTop: 14 } },
              h('h2', { style: styles.cardTitle }, templateIsNew ? '新建模板' : '编辑模板'),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 } },
                h('label', { style: { minWidth: 0 } },
                  h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '模板名称'),
                  h('input', { value: templateName, onChange: (event) => setTemplateName(event.target.value), style: styles.input })),
                h('label', { style: { minWidth: 0 } },
                  h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '描述'),
                  h('input', { value: templateDescription, onChange: (event) => setTemplateDescription(event.target.value), style: styles.input }))),
              h('p', { style: { ...styles.muted, marginTop: 0 } }, '这些开关保存到 templates.json；default 模板决定新工作区的初始状态，不会自动改动已有工作区。默认模板可修改但不可删除。'),
              (cap?.groups || []).map((group) => h(GroupCard, {
                key: `template-${group.id}`, group, policy: templateDraft, descriptions: cap?.toolDescriptions || {},
                onGroup: templateSetGroup, onSubgroup: templateSetSubgroup, onTool: templateSetTool,
              })),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' } },
                h(Button, { onClick: saveTemplate, disabled: savingTemplate, style: styles.buttonAccent }, savingTemplate ? '保存中…' : (templateIsNew ? '保存新模板' : '保存模板')),
                h(Button, {
                  onClick: deleteTemplate,
                  disabled: savingTemplate || templateIsNew || templateId === 'default' || !templateId,
                  style: styles.buttonDanger,
                  title: templateId === 'default' ? '默认模板只能修改，不能删除' : '删除当前模板',
                }, '删除模板'),
                h(Button, { onClick: closeTemplateEditor, disabled: savingTemplate }, '取消'))),

            h('section', { id: 'ws-scope-tools', style: { ...styles.card, marginBottom: 14 } },
              h('h2', { style: styles.cardTitle }, '工具组'),
              policy && h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
                h(Button, { onClick: toggleAll, disabled: busy || !cap, style: styles.buttonAccent, title: '只切换能力组与单工具，不碰规则/SOUL/记忆；改完点全部保存并应用' }, allOn ? '全部关闭' : '全部开启'),
                h(Button, { onClick: openManage, disabled: busy }, '管理分组')),
              renderFavoriteGroupCard(),
              h('hr', { style: styles.divider }),
              h('h3', { style: styles.subTitle }, '能力组'),
              !policy && h('p', { style: styles.muted }, '没有可用的策略草稿。请选择工作区，或确认 Host API 正常。'),
              policy && mcpServersOf(cap).map((server) => h(McpGroupCard, {
                key: `mcp-${server.id}`,
                server,
                policy,
                descriptions: cap?.toolDescriptions || {},
                onServer: setMcpServer,
                onTool: setTool,
              })),
              policy && displayGroups.map((group) => h(GroupCard, {
                key: group.id, group, policy, descriptions: cap?.toolDescriptions || {},
                onGroup: setGroup, onSubgroup: setSubgroup, onTool: setTool,
              }))),

            h('section', { id: 'ws-scope-mcp', style: { ...styles.card, marginBottom: 14 } },
              h('h2', { style: styles.cardTitle }, 'MCP 服务器'),
              h('p', { style: { ...styles.muted, marginTop: 0 } }, 'MCP Server 的连接、凭据和资源由 MCP 客户端管理；这里只展示它动态注册的工具。工具授权统一在「工具组」的 MCP 组中配置，不再维护第二套 MCP 开关。'),
              mcpServersOf(cap).length === 0
                ? h('p', { style: styles.muted }, '当前未发现 MCP 工具。')
                : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                    mcpServersOf(cap).map((server) => h('div', { key: server.id, style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' } },
                      h('strong', { style: { fontSize: 13 } }, server.name),
                      h('span', { style: styles.muted }, `${server.tools.length} 个工具`),
                      h('span', { style: { ...styles.muted, color: policy && mcpServerOn(policy, server.id) ? 'var(--dsw-alias-state-success-primary)' : undefined } },
                        policy && mcpServerOn(policy, server.id) ? '本工作区已放行' : '本工作区未放行'))))),

            h('section', { id: 'ws-scope-rules', style: { ...styles.card, marginBottom: 14 } },
              h('h2', { style: styles.cardTitle }, '规则与SOUL'),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h(Checkbox, { checked: policy?.rules?.global !== false, onChange: (checked) => setRule('global', checked), label: '全局 RULE（跨工作区；关闭时同时隐藏 global_rule 工具）' })),
              h('hr', { style: styles.divider }),
              h('label', { style: { ...styles.toolRow, padding: '5px 0', marginTop: 0 } },
                h('input', {
                  type: 'checkbox', checked: policy?.identity?.soulEnabled === true,
                  onChange: (event) => setSoulEnabled(event.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
                }),
                h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('span', { style: { fontSize: 12 } }, '启用 SOUL（本工作区）'),
                  h('span', { style: { ...styles.muted, fontSize: 11 } }, '独立于记忆；关闭时不注入 SOUL'))),
              h('label', { style: { ...styles.toolRow, padding: '5px 0', marginTop: 0 } },
                h('input', {
                  type: 'checkbox', checked: policy?.memory?.soulAiWritable === true,
                  onChange: (event) => setMemory('soulAiWritable', event.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
                }),
                h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('span', { style: { fontSize: 12 } }, '允许 AI 写 SOUL'),
                  h('span', { style: { ...styles.muted, fontSize: 11 } }, '默认关；用户始终可编辑'))),
              h(SoulEditor, {
                enabled: policy?.identity?.soulEnabled === true,
                content: soulContent,
                loaded: soulLoaded,
                busy: busy || soulBusy,
                status: soulStatus,
                onChange: updateSoul,
                onSave: saveSoulOnly,
              })),

            h('section', { id: 'ws-scope-memory', style: { ...styles.card, marginBottom: 14 } },
              h('h2', { style: styles.cardTitle }, '记忆'),
              h('label', { style: { ...styles.toolRow, padding: '5px 0', marginTop: 0 } },
                h('input', {
                  type: 'checkbox', checked: policy?.memory?.enabled === true,
                  onChange: (event) => setMemory('enabled', event.target.checked),
                  style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 2 },
                }),
                h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('span', { style: { fontSize: 12 } }, '启用记忆（本工作区）'),
                  h('span', { style: { ...styles.muted, fontSize: 11 } }, '关闭时不建库、不注入、不注册记忆工具'))),
              h('label', { style: { display: 'block', marginTop: 8 } },
                h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆审核模式'),
                h('select', {
                  value: policy?.memory?.reviewMode || (policy?.memory?.judge === false ? 'off' : 'auto'),
                  onChange: (event) => setMemory('reviewMode', event.target.value),
                  style: { ...styles.select, width: '100%', maxWidth: '100%' },
                },
                  h('option', { value: 'auto' }, '自动 judge：主题匹配才入库'),
                  h('option', { value: 'off' }, '关闭 judge：全部直接入库'),
                  h('option', { value: 'manual' }, '手动审批：全部进待审区'))),
              h('p', { style: { ...styles.muted, margin: '4px 0 0' } }, '自动模式需要主题；关闭或手动模式默认没有主题，也不会再询问是否设置主题。'),
              h('hr', { style: styles.divider }),
              h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
                h('label', { style: { flex: '1 1 260px', minWidth: 0 } },
                  h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, 'judge 模型'),
                  h(ModelSelect, {
                    value: policy?.memory?.judgeModel || '',
                    onChange: (value) => setMemory('judgeModel', value),
                    emptyLabel: '默认（DSH 代理默认模型）',
                  }))),
              (policy?.memory?.reviewMode || (policy?.memory?.judge === false ? 'off' : 'auto')) === 'auto' && h('div', { style: { display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' } },
                h('label', { style: { flex: '1 1 220px', minWidth: 0 } },
                  h('span', { style: { ...styles.muted, display: 'block', marginBottom: 4 } }, '记忆主题'),
                  h('input', { value: policy?.memory?.theme || '', onChange: (event) => setMemory('theme', event.target.value), placeholder: '例如：DSH 插件开发', style: styles.input }))),
              h(QuarantineList, { workspace, enabled: policy?.memory?.enabled === true, collapsible: true }),
              h(MemorySwitchPanel, { policy, setMemory, workspace })),

          h('div', null,
            h('section', { id: 'ws-scope-preview', style: styles.card },
              h('h2', { style: styles.cardTitle }, '预览'),
              h('div', { style: { display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8 } },
                h('span', { style: { fontSize: 24, fontWeight: 600 } }, String(enabledCount)),
                h('span', { style: styles.muted }, `/ ${totalCount} 个工具启用`)),
              h('p', { style: { ...styles.muted, marginTop: 0 } }, enabledGroups.length ? enabledGroups.join('、') : '没有开启任何能力组'),
              h('hr', { style: styles.divider }),
              h('div', { style: { ...styles.muted, marginTop: 8 } }, `已启用工具（草稿，随勾选即时更新）`),
              h('div', { style: styles.previewToolGrid },
                enabledToolStates.map((tool) => h('span', { key: tool.name, title: tool.name, style: styles.previewToolName }, tool.name))),
              h('hr', { style: styles.divider }),
              h('div', { style: styles.muted }, '策略文件'),
              h('div', { style: styles.code }, workspace?.policyPath || '（尚未写入）'),
              h('div', { style: { ...styles.muted, marginTop: 6 } }, 'revision：', h('span', { style: styles.code }, revision || '—')),
              h('p', { style: { ...styles.muted, marginTop: 10 } }, '保存后，工具列表会在下一次请求刷新；需要 registry 级限制时请新开会话。'))
          ))),

        h('div', { style: styles.stickyBar },
          h('span', { style: { ...styles.muted, marginRight: 'auto' } }, '全部改动（含 SOUL）保存后生效'),
          h(Button, { onClick: save, disabled: busy || soulBusy || !policy, style: styles.buttonAccent }, busy ? '保存中…' : '全部保存并应用')),

        manageOpen && h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.manage },
            h('div', { style: styles.wizardHeader },
              h('div', null,
                h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, '管理分组与收藏'),
                h('div', { style: styles.wizardStep }, '收藏独立；分组先选定组，再添加/移除工具；一个工具只属于一个能力组')),
              h(Button, { onClick: closeManage, disabled: manageBusy }, '关闭')),
            h('div', { style: styles.manageTabs },
              renderManageTabButton('favorites', '收藏'),
              renderManageTabButton('groups', '分组'),
              renderManageTabButton('new-group', '新建组')),
            manageNotice && h('div', { style: { ...styles.banner, color: manageNotice.type === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } }, manageNotice.text),
            manageLoading
              ? h('p', { style: styles.muted }, '加载能力与收藏…')
              : (manageTab === 'favorites'
                ? renderManageFavorites()
                : manageTab === 'groups'
                  ? renderManageGroups()
                  : renderManageNewGroup())
          )),

        wizardOpen && h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.wizard },
            h('div', { style: styles.wizardHeader },
              h('div', null,
                h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, '新工作区配置向导'),
                h('div', { style: styles.wizardStep }, `步骤 ${wizardStep} / 4 · ${['选择模板', '调整能力', '规则与 SOUL', '确认并保存'][wizardStep - 1]}`)),
              h(Button, { onClick: closeWizard, disabled: wizardBusy }, '关闭')),
            renderWizardStep(),
            h('div', { style: styles.wizardFooter },
              h(Button, { onClick: () => setWizardStep((step) => Math.max(1, step - 1)), disabled: wizardBusy || wizardStep === 1 }, '上一步'),
              h(Button, { onClick: () => setWizardStep((step) => Math.min(4, step + 1)), disabled: wizardBusy || wizardStep === 4 }, '下一步'),
              h(Button, { onClick: saveWizard, disabled: wizardBusy || wizardStep !== 4, style: styles.buttonAccent }, wizardBusy ? '保存中…' : '完成并保存')))),

        saveDialog && h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal },
            h('h3', { style: { margin: '0 0 8px', fontSize: 16, fontWeight: 600 } }, '保存模板'),
            h('p', { style: { ...styles.muted, marginTop: 0 } }, `要覆盖原模板「${templates.find((template) => template.id === templateId)?.name || templateId}」，还是另存为新模板？`),
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' } },
              h(Button, { onClick: () => commitTemplate('overwrite'), disabled: savingTemplate, style: styles.buttonAccent }, '覆盖原模板'),
              h(Button, { onClick: saveTemplateAsCopy, disabled: savingTemplate }, '另存为新模板'),
              h(Button, { onClick: () => setSaveDialog(false), disabled: savingTemplate }, '取消')))),

        copyDialog && h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal },
            h('h3', { style: { margin: '0 0 8px', fontSize: 16, fontWeight: 600 } }, '另存为新模板'),
            h('p', { style: { ...styles.muted, marginTop: 0 } }, `原模板「${templates.find((template) => template.id === templateId)?.name || templateId}」保持不变。`),
            h('input', {
              value: copyName, autoFocus: true,
              onChange: (event) => setCopyName(event.target.value),
              placeholder: '新模板名称',
              style: styles.input,
            }),
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' } },
              h(Button, { onClick: confirmTemplateCopy, disabled: savingTemplate || !copyName.trim(), style: styles.buttonAccent }, savingTemplate ? '保存中…' : '另存为新模板'),
              h(Button, { onClick: () => setCopyDialog(false), disabled: savingTemplate }, '取消')))),

        deleteDialogOpen && h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal },
            h('h3', { style: { margin: '0 0 8px', fontSize: 16, fontWeight: 600 } }, '删除策略'),
            h('p', { style: { ...styles.muted, marginTop: 0 } }, '删除后本插件不再接管这个工作区，工具恢复全开；工作区和会话不会删除。'),
            deleteError && h('p', { style: { ...styles.muted, color: 'var(--dsw-alias-state-error-primary)', margin: 0 } }, deleteError),
            h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 8, cursor: deleteBusy ? 'default' : 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: deleteMemoryToo,
                disabled: deleteBusy,
                onChange: (event) => setDeleteMemoryToo(event.target.checked),
                style: { accentColor: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto', marginTop: 3 },
              }),
              h('span', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
                h('span', { style: { fontSize: 13 } }, '同时删除本工作区的记忆库'),
                h('span', { style: { ...styles.muted, fontSize: 11, wordBreak: 'break-all' } },
                  workspace?.path ? `${workspace.path}\\.dsh-scope\\memory.db` : '（记忆库路径未知）'),
                h('span', { style: { ...styles.muted, fontSize: 11 } }, '会删除 memory.db、WAL/SHM 和 .bak 备份；不可恢复。'))),
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' } },
              h(Button, { onClick: () => setDeleteDialogOpen(false), disabled: deleteBusy }, '取消'),
              h(Button, {
                onClick: confirmDeletePolicy,
                disabled: deleteBusy,
                style: styles.buttonDanger,
              }, deleteBusy ? '删除中…' : (deleteMemoryToo ? '删除策略和记忆库' : '删除策略'))))),

        exitPrompt && h('div', { style: styles.modalBackdrop },
          h('div', { style: styles.modal },
            h('h3', { style: { margin: '0 0 8px', fontSize: 16, fontWeight: 600 } }, '有未保存的修改'),
            h('p', { style: { ...styles.muted, marginTop: 0 } }, '要保存全部设置并退出，还是放弃这次修改？'),
            h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' } },
              h(Button, {
                onClick: async () => {
                  const ok = await save();
                  if (ok) {
                    setExitPrompt(false);
                    if (typeof close === 'function') close();
                  }
                },
                disabled: busy,
                style: styles.buttonAccent,
              }, busy ? '保存中…' : '全部保存并退出'),
              h(Button, {
                onClick: () => {
                  setExitPrompt(false);
                  if (typeof close === 'function') close();
                },
                disabled: busy,
                style: styles.buttonDanger,
              }, '放弃修改并退出'),
              h(Button, { onClick: () => setExitPrompt(false), disabled: busy }, '继续编辑')))),
      );
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const QuarantinePanel = () => h(QuarantinePage, {
          onClose: () => { try { ctx.layout.selectPanel(null); } catch { /* old client */ } },
        });
        const QuarantineSidebarEntry = ({ wide }) => h('button', {
          type: 'button',
          className: 'workspace-scope-quarantine-entry',
          title: '工作区记忆管理',
          'aria-label': '工作区记忆管理',
          onClick: () => { try { ctx.layout.selectPanel(QUARANTINE_PANEL_KEY); } catch { /* old client */ } },
          style: {
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px',
            border: 0, borderRadius: 8, cursor: 'pointer', font: 'inherit', fontSize: 12,
          },
        },
        h('span', { style: { fontSize: 16, lineHeight: 1 } }, '🧠'),
        wide ? h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, '工作区记忆管理') : null);
        const WorkspaceScopeSettings = (props) => h(WorkspaceScopePage, {
          ...props,
          onOpenQuarantine: () => { try { ctx.layout.selectPanel(QUARANTINE_PANEL_KEY); } catch { /* old client */ } },
        });

        const uiStyle = document.createElement('style');
        uiStyle.dataset.plugin = 'workspace-scope-ui-polish';
        uiStyle.textContent = [
          '.workspace-scope-page button{transition:filter .12s ease,background-color .12s ease,border-color .12s ease,color .12s ease}',
          '.workspace-scope-page button:not(:disabled):hover{filter:brightness(.96)}',
          '.workspace-scope-page button:focus-visible,.workspace-scope-page summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f7cff);outline-offset:2px}',
          '.workspace-scope-page input:focus-visible,.workspace-scope-page select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#4f7cff);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4f7cff) 22%,transparent)}',
          '.workspace-scope-page details>summary{cursor:pointer}',
          '.workspace-scope-page details>summary::marker{color:var(--dsw-alias-label-secondary,#777)}',
          '.workspace-scope-page ::-webkit-scrollbar{width:10px;height:10px}',
          '.workspace-scope-page ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#c8c8c8);border:2px solid transparent;background-clip:padding-box;border-radius:999px}',
          '.workspace-scope-page ::-webkit-scrollbar-track{background:transparent}',
        ].join('');
        document.head.appendChild(uiStyle);
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => uiStyle.remove(), 'workspace-scope: ui polish');
        }

        // LOCAL-ONLY BEGIN: vertical footer layout, stripped from public release.
        const footerStyle = document.createElement('style');
        footerStyle.dataset.plugin = 'workspace-scope-footer-stack';
        footerStyle.textContent = '[class*="footerActions"]{flex-direction:column;align-items:stretch;gap:2px}[class*="footerActions"]>*{width:100%;min-width:0}.workspace-scope-quarantine-entry{background:transparent;color:var(--dsw-alias-label-secondary,#555);transition:background-color .12s ease,color .12s ease}.workspace-scope-quarantine-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}';
        document.head.appendChild(footerStyle);
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => () => footerStyle.remove(), 'workspace-scope: footer stack');
        }
        // LOCAL-ONLY END

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: QUARANTINE_PANEL_KEY,
        }, QuarantinePanel));
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'workspace-scope-quarantine',
          order: 50,
          label: '工作区记忆管理',
        }, QuarantineSidebarEntry));
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'workspace-scope',
          order: 40,
          label: '工作区扩展',
        }, WorkspaceScopeSettings));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'workspace-scope-auto-wizard',
          order: 20,
        }, NewWorkspaceAutoWizard));
      },
    };
  },
});

window.__ModuleLoader__.load({
  id: "dsh-meow-scope",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  MemoryFoldDock: () => MemoryFoldDock,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");

// src/i18n/en.ts
var en = {
  // ── reflection / dream turn bars ──────────────────────────────────────────
  "fold.title.reflect": "Memory reflection",
  "fold.title.dream": "Memory dream task",
  "fold.status.running": "{title} in progress\u2026",
  "fold.hint.running": " (your message joins this turn)",
  "fold.status.interrupted": "{title} interrupted",
  "fold.status.remembered": "{title} \xB7 {n} memories added",
  "fold.status.updated": "{title} \xB7 {n} updated",
  "fold.status.nothing": "{title} \xB7 nothing to save",
  // ── memory injection bars ─────────────────────────────────────────────────
  "inject.bar": "Memory injected",
  "inject.kind.first": " (long-term)",
  "inject.kind.hit": " (keyword hits)",
  "inject.expand": "Click to expand",
  "inject.collapse": "Click to collapse",
  "inject.copy": "Copy",
  "inject.copied": "Copied",
  "inject.result": "[Result]",
  // ── delegate marker bubbles ───────────────────────────────────────────────
  "notice.reflect.running": "\u25B8 Memory reflection task in progress\u2026",
  "notice.reflect.done": "\u25B8 Memory reflection task completed.",
  "notice.dream.running": "\u25B8 Memory dream task in progress\u2026",
  "notice.dream.done": "\u25B8 Memory dream task completed.",
  "notice.dream.interrupted": "\u25B8 Memory dream task interrupted; retrying automatically later.",
  // ── session menu ──────────────────────────────────────────────────────────
  "part.menu": "Memory participation",
  "part.state.active": "All on",
  "part.state.writeonly": "No auto-injection",
  "part.state.readonly": "No auto-consolidation",
  "part.state.exited": "Tools only",
  "part.panel.inject": "Auto injection (first-turn, per-turn, post-compaction)",
  "part.panel.consolidate": "Auto consolidation (reflect + dream)",
  "part.panel.on": "On",
  "part.panel.off": "Off",
  // ── settings tab ──────────────────────────────────────────────────────────
  "settings.title": "Meow memory",
  "settings.summary": 'Every setting of the cross-session memory plugin. Changes are stored in DSH settings (per field; "Restore default" goes back to the plugin factory default and ignores the patch assembly baseline); they take effect after a hot reload or restart of the meow-memory plugin.',
  "settings.loading": "Loading meow-memory configuration\u2026",
  "settings.unavailable": "This connection does not support settings writes (only loopback connections can edit).",
  "settings.readonly": "This connection is read-only (settings writes are limited to loopback connections).",
  "settings.saved": "Saved \u2713 takes effect after a hot reload or restart of the meow-memory plugin",
  "settings.badge.override": "Overridden",
  "settings.badge.default": "Default",
  "settings.reset": "Restore default",
  "settings.saveFailed": "Save failed: {error}",
  "settings.saveNotApplied": "Save did not take effect: the server rejected the write (it may have failed validation). Showing the current server value again.",
  "settings.resetFailed": "Restore default failed: {error}",
  "settings.resetNotApplied": "Restore default did not take effect; please try again.",
  "settings.suppress.format": 'A window must look like "HH:MM-HH:MM"; got "{value}"',
  "settings.suppress.atLeastOne": "At least one window is required",
  "settings.group.base": "Basics",
  "settings.group.inject": "Injection and hits",
  "settings.group.reflect": "Reflection",
  "settings.group.delegate": "Consolidation task model",
  "settings.group.dream": "Idle consolidation (dream)",
  "settings.group.language": "Language",
  "settings.group.storage": "Directories & migration",
  "settings.field.enabled.label": "Master switch",
  "settings.field.enabled.hint": "When off, injection, reflection and the memory tools are all disabled",
  "settings.field.projectDir.label": "Memory directory",
  "settings.field.projectDir.hint": "Data directory, relative to the workspace",
  "settings.field.homeDir.label": "Global data directory",
  "settings.field.homeDir.hint": "Where instance-level data (logs, window index) lives. On change, contents of the old directory are migrated automatically (same-disk move / cross-disk copy); after a cross-disk copy the old directory is kept \u2014 delete it manually once verified. If multiple dsh instances share one directory, update them together.",
  "settings.field.homeDir.preset.default": "System user home (default)",
  "settings.field.homeDir.preset.dshStorage": "DSH home storage",
  "settings.field.homeDir.preset.pluginRoot": "Plugin folder",
  "settings.field.homeDir.preset.custom": "Custom path",
  "settings.mirrorReadonly": "Non-local connection: dsh serves this settings page as a read-only mirror and no change will be saved. Open dsh via 127.0.0.1 on the host machine to edit settings.",
  "settings.field.autoMigrate.label": "Auto-migrate old database",
  "settings.field.autoMigrate.hint": "Migrate PROJECT.md automatically the first time a v1 database is opened",
  "settings.field.hitTopK.label": "Max hits per message",
  "settings.field.hitTopK.hint": "Upper bound on keyword-hit entries injected per message (fact/lesson/rules/topic)",
  "settings.field.titleMax.label": "Guide title truncation length",
  "settings.field.titleMax.hint": "Truncation length (characters) of the project list in the memory guide",
  "settings.field.reflect.label": "Automatic reflection",
  "settings.field.reflect.hint": "Review memory automatically after a task ends",
  "settings.field.reflectTurns.label": "Reflection trigger turns",
  "settings.field.reflectTurns.hint": "Consecutive tool steps inside one task needed to trigger at the end",
  "settings.field.delegateModel.label": "Reflection/dream model override",
  "settings.field.delegateModel.hint": "Empty = the main model throughout. When set, reflection and dream turns run on that model and switch back to the main model at the end of the turn (the rest of the conversation is unaffected); 'provider/model' selects the route, 'model' only changes the model name",
  "settings.field.delegateModel.placeholder": "e.g. provider/model",
  "settings.field.dreamEnabled.label": "Idle consolidation switch",
  "settings.field.dream.idleMinutes.label": "Idle minutes",
  "settings.field.dream.idleMinutes.hint": "A window idle for this many minutes allows a dream",
  "settings.field.dream.suppressWindows.label": "Peak-hour suppression windows",
  "settings.field.dream.suppressWindows.hint": 'Comma-separated "HH:MM-HH:MM"; no dream is triggered inside these windows',
  "settings.field.dream.suppressLeadMinutes.label": "Extra suppression before peak (minutes)",
  "settings.field.dream.checkMinutes.label": "Check interval (minutes)",
  "settings.field.dream.timeZone.label": "Timezone for suppression windows",
  "settings.field.dream.timeZone.hint": "Peak windows are computed in this fixed timezone (independent of the system clock)",
  "settings.field.dream.rulesReviewDays.label": "Rules anti-churn days",
  "settings.field.dream.rulesReviewDays.hint": "Stable rules whose updated_at is older than this many days skip dream round 1; 0 = no filter",
  "settings.field.promptLang.label": "Prompt and retrieval language",
  "settings.field.promptLang.hint": "Empty = zh by default (sessions that never configured it get a one-time first-run guide); 'en' = built-in English pack. The UI language is unrelated \u2014 that follows the DSH language setting. The language must match the one you speak, or keyword hit rates drop",
  "settings.field.promptLang.placeholder": "zh / en",
  // ── date and time ─────────────────────────────────────────────────────────
  "datetime.ymd": "{m}/{d}",
  "datetime.ymdFull": "{y}/{m}/{d}"
};

// src/i18n/zh.ts
var zh = {
  // ── 反思 / dream 轮横条 ────────────────────────────────────────────────────
  "fold.title.reflect": "\u8BB0\u5FC6\u53CD\u601D",
  "fold.title.dream": "\u8BB0\u5FC6\u68A6\u5883\u4EFB\u52A1",
  "fold.status.running": "{title}\u8FDB\u884C\u4E2D\u2026",
  "fold.hint.running": "\uFF08\u63D2\u8BDD\u4F1A\u62FC\u8FDB\u672C\u8F6E\uFF09",
  "fold.status.interrupted": "{title}\u5DF2\u4E2D\u65AD",
  "fold.status.remembered": "{title} \xB7 \u65B0\u589E\u8BB0\u5FC6 {n} \u6761",
  "fold.status.updated": "{title} \xB7 \u5DF2\u66F4\u65B0 {n} \u6761",
  "fold.status.nothing": "{title} \xB7 \u65E0\u9700\u8BB0\u5FC6",
  // ── 记忆注入横条 ──────────────────────────────────────────────────────────
  "inject.bar": "\u5DF2\u6CE8\u5165\u8BB0\u5FC6",
  "inject.kind.first": "\uFF08\u957F\u671F\u8BB0\u5FC6\uFF09",
  "inject.kind.hit": "\uFF08\u5173\u952E\u8BCD\u547D\u4E2D\uFF09",
  "inject.expand": "\u70B9\u51FB\u5C55\u5F00",
  "inject.collapse": "\u70B9\u51FB\u6536\u8D77",
  "inject.copy": "\u590D\u5236",
  "inject.copied": "\u5DF2\u590D\u5236",
  "inject.result": "\u3010\u7ED3\u679C\u3011",
  // ── delegate 打点气泡 ─────────────────────────────────────────────────────
  "notice.reflect.running": "\u25B8 \u8BB0\u5FC6\u53CD\u601D\u4EFB\u52A1\u8FDB\u884C\u4E2D\u2026\u2026",
  "notice.reflect.done": "\u25B8 \u8BB0\u5FC6\u53CD\u601D\u4EFB\u52A1\u5DF2\u5B8C\u6210\u3002",
  "notice.dream.running": "\u25B8 \u68A6\u5883\u8BB0\u5FC6\u6574\u7406\u4EFB\u52A1\u8FDB\u884C\u4E2D\u2026\u2026",
  "notice.dream.done": "\u25B8 \u68A6\u5883\u8BB0\u5FC6\u6574\u7406\u4EFB\u52A1\u5DF2\u5B8C\u6210\u3002",
  "notice.dream.interrupted": "\u25B8 \u68A6\u5883\u8BB0\u5FC6\u6574\u7406\u5DF2\u4E2D\u65AD\uFF0C\u7A0D\u540E\u81EA\u52A8\u91CD\u8BD5\u3002",
  // ── 会话菜单 ──────────────────────────────────────────────────────────────
  "part.menu": "\u8BB0\u5FC6\u53C2\u4E0E",
  "part.state.active": "\u529F\u80FD\u5168\u5F00",
  "part.state.writeonly": "\u4E0D\u81EA\u52A8\u6CE8\u5165",
  "part.state.readonly": "\u4E0D\u81EA\u52A8\u6574\u7406",
  "part.state.exited": "\u53EA\u7528\u5DE5\u5177",
  "part.panel.inject": "\u81EA\u52A8\u6CE8\u5165\uFF08\u9996\u8F6E\u3001\u6BCF\u8F6E\u3001\u538B\u7F29\u540E\u91CD\u6CE8\u5165\uFF09",
  "part.panel.consolidate": "\u81EA\u52A8\u6574\u7406\uFF08\u53CD\u601D\u3001\u68A6\u5883\uFF09",
  "part.panel.on": "\u6253\u5F00",
  "part.panel.off": "\u5173\u95ED",
  // ── 设置页 ────────────────────────────────────────────────────────────────
  "settings.title": "\u55B5\u8BB0\u5FC6",
  "settings.summary": "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6\u63D2\u4EF6\u7684\u5168\u90E8\u8BBE\u7F6E\u3002\u6539\u52A8\u4FDD\u5B58\u5728 DSH \u8BBE\u7F6E\u91CC\uFF08\u5B57\u6BB5\u7EA7\uFF0C\u300C\u6062\u590D\u9ED8\u8BA4\u300D= \u56DE\u5230\u63D2\u4EF6\u51FA\u5382\u9ED8\u8BA4\uFF0C\u4E0D\u53D7 patch \u88C5\u914D\u57FA\u7EBF\u5F71\u54CD\uFF09\uFF1B\u751F\u6548\u9700\u8981\u70ED\u91CD\u8F7D/\u91CD\u542F meow-memory \u63D2\u4EF6\u3002",
  "settings.loading": "\u55B5\u8BB0\u5FC6\u914D\u7F6E\u52A0\u8F7D\u4E2D\u2026",
  "settings.unavailable": "\u5F53\u524D\u8FDE\u63A5\u4E0D\u652F\u6301\u8BBE\u7F6E\u5199\u5165\uFF08\u4EC5\u672C\u673A\u56DE\u73AF\u8FDE\u63A5\u53EF\u7F16\u8F91\uFF09\u3002",
  "settings.readonly": "\u5F53\u524D\u8FDE\u63A5\u4E3A\u53EA\u8BFB\uFF08\u8BBE\u7F6E\u5199\u5165\u4EC5\u9650\u672C\u673A\u56DE\u73AF\u8FDE\u63A5\uFF09\u3002",
  "settings.saved": "\u5DF2\u4FDD\u5B58 \u2713 \u70ED\u91CD\u8F7D/\u91CD\u542F meow-memory \u63D2\u4EF6\u540E\u751F\u6548",
  "settings.badge.override": "\u5DF2\u8986\u76D6",
  "settings.badge.default": "\u9ED8\u8BA4",
  "settings.reset": "\u6062\u590D\u9ED8\u8BA4",
  "settings.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{error}",
  "settings.saveNotApplied": "\u4FDD\u5B58\u672A\u751F\u6548\uFF1A\u5199\u5165\u88AB\u670D\u52A1\u5668\u62D2\u7EDD\uFF08\u53EF\u80FD\u672A\u901A\u8FC7\u6821\u9A8C\uFF09\uFF0C\u5DF2\u6062\u590D\u663E\u793A\u670D\u52A1\u5668\u5F53\u524D\u503C\u3002",
  "settings.resetFailed": "\u6062\u590D\u9ED8\u8BA4\u5931\u8D25\uFF1A{error}",
  "settings.resetNotApplied": "\u6062\u590D\u9ED8\u8BA4\u672A\u751F\u6548\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "settings.suppress.format": '\u65F6\u6BB5\u683C\u5F0F\u5E94\u4E3A "HH:MM-HH:MM"\uFF0C\u6536\u5230 "{value}"',
  "settings.suppress.atLeastOne": "\u81F3\u5C11\u4E00\u4E2A\u65F6\u6BB5",
  "settings.group.base": "\u57FA\u7840",
  "settings.group.inject": "\u6CE8\u5165\u4E0E\u547D\u4E2D",
  "settings.group.reflect": "\u53CD\u601D",
  "settings.group.delegate": "\u6574\u7406\u4EFB\u52A1\u6A21\u578B",
  "settings.group.dream": "\u7A7A\u95F2\u6574\u7406\uFF08dream\uFF09",
  "settings.group.language": "\u8BED\u8A00",
  "settings.group.storage": "\u76EE\u5F55\u4E0E\u8FC1\u79FB",
  "settings.field.enabled.label": "\u603B\u5F00\u5173",
  "settings.field.enabled.hint": "\u5173\u95ED\u540E\u6CE8\u5165\u3001\u53CD\u601D\u3001\u8BB0\u5FC6\u5DE5\u5177\u5168\u90E8\u505C\u7528",
  "settings.field.projectDir.label": "\u8BB0\u5FC6\u76EE\u5F55",
  "settings.field.projectDir.hint": "\u76F8\u5BF9\u5DE5\u4F5C\u533A\u7684\u6570\u636E\u76EE\u5F55",
  "settings.field.homeDir.label": "\u5168\u5C40\u6570\u636E\u76EE\u5F55",
  "settings.field.homeDir.hint": "\u65E5\u5FD7\u7B49\u5B9E\u4F8B\u7EA7\u6570\u636E\u7684\u5B58\u653E\u4F4D\u7F6E\u3002\u5207\u6362\u540E\u81EA\u52A8\u628A\u65E7\u76EE\u5F55\u5185\u5BB9\u8FC1\u8FC7\u53BB\uFF08\u540C\u76D8\u79FB\u52A8/\u8DE8\u76D8\u590D\u5236\uFF09\uFF1B\u8DE8\u76D8\u590D\u5236\u65F6\u65E7\u76EE\u5F55\u4FDD\u7559\uFF0C\u786E\u8BA4\u65E0\u8BEF\u540E\u8BF7\u624B\u52A8\u5220\u9664\u3002\u82E5\u591A\u4E2A dsh \u5B9E\u4F8B\u5171\u4EAB\u540C\u4E00\u76EE\u5F55\uFF0C\u8BF7\u540C\u6B65\u4FEE\u6539\u5176\u4ED6\u5B9E\u4F8B\u7684\u8BBE\u7F6E\u3002",
  "settings.field.homeDir.preset.default": "\u7CFB\u7EDF\u7528\u6237\u4E3B\u76EE\u5F55\uFF08\u9ED8\u8BA4\uFF09",
  "settings.field.homeDir.preset.dshStorage": "DSH \u6839\u76EE\u5F55 Storage",
  "settings.field.homeDir.preset.pluginRoot": "\u63D2\u4EF6\u672C\u4F53\u6839\u76EE\u5F55",
  "settings.field.homeDir.preset.custom": "\u81EA\u5B9A\u4E49\u8DEF\u5F84",
  "settings.mirrorReadonly": "\u5F53\u524D\u4E3A\u975E\u672C\u673A\u8FDE\u63A5\uFF1Adsh \u5C06\u8BBE\u7F6E\u9875\u964D\u4E3A\u53EA\u8BFB\u955C\u50CF\uFF0C\u4EFB\u4F55\u4FEE\u6539\u90FD\u4E0D\u4F1A\u88AB\u4FDD\u5B58\u3002\u8BF7\u5728\u5BBF\u4E3B\u672C\u673A\u901A\u8FC7 127.0.0.1 \u8BBF\u95EE dsh \u540E\u518D\u4FEE\u6539\u914D\u7F6E\u3002",
  "settings.field.autoMigrate.label": "\u81EA\u52A8\u8FC1\u79FB\u65E7\u5E93",
  "settings.field.autoMigrate.hint": "\u9996\u6B21\u6253\u5F00 v1 \u5E93\u65F6\u81EA\u52A8\u8FC1\u79FB PROJECT.md",
  "settings.field.hitTopK.label": "\u6BCF\u6761\u6D88\u606F\u547D\u4E2D\u6761\u6570\u4E0A\u9650",
  "settings.field.hitTopK.hint": "\u5173\u952E\u8BCD\u547D\u4E2D\u6CE8\u5165\u7684\u6761\u76EE\u4E0A\u9650\uFF08fact/lesson/rules/topic\uFF09",
  "settings.field.titleMax.label": "\u5BFC\u5F15\u6807\u9898\u622A\u65AD\u957F\u5EA6",
  "settings.field.titleMax.hint": "\u8BB0\u5FC6\u5BFC\u5F15\u91CC\u9879\u76EE\u5217\u8868\u7684\u622A\u65AD\u957F\u5EA6\uFF08\u5B57\u7B26\uFF09",
  "settings.field.reflect.label": "\u81EA\u52A8\u53CD\u601D",
  "settings.field.reflect.hint": "\u4EFB\u52A1\u7ED3\u675F\u540E\u81EA\u52A8\u56DE\u987E\u8BB0\u5FC6",
  "settings.field.reflectTurns.label": "\u53CD\u601D\u89E6\u53D1\u8F6E\u6570",
  "settings.field.reflectTurns.hint": "\u5355\u4EFB\u52A1\u5185\u8FDE\u7EED\u5DE5\u5177\u6B65\u8FBE\u5230\u8BE5\u503C\u624D\u5728\u7ED3\u675F\u65F6\u89E6\u53D1",
  "settings.field.delegateModel.label": "\u53CD\u601D/\u68A6\u5883\u6362\u6A21\u578B",
  "settings.field.delegateModel.hint": "\u7559\u7A7A=\u5168\u7A0B\u4E3B\u6A21\u578B\u3002\u586B\u5199\u540E\u53CD\u601D\u8F6E\u4E0E\u68A6\u5883\u8F6E\u81EA\u52A8\u6362\u7528\u8BE5\u6A21\u578B\u6267\u884C\uFF0C\u8F6E\u6B21\u7ED3\u675F\u81EA\u52A8\u6362\u56DE\u4E3B\u6A21\u578B\uFF08\u5176\u4F59\u5BF9\u8BDD\u4E0D\u53D7\u5F71\u54CD\uFF09\uFF1B'provider/model' \u6307\u5B9A\u8DEF\u7531\uFF0C'model' \u53EA\u6362\u6A21\u578B\u540D",
  "settings.field.delegateModel.placeholder": "\u5982 provider/model",
  "settings.field.dreamEnabled.label": "\u7A7A\u95F2\u6574\u7406\u5F00\u5173",
  "settings.field.dream.idleMinutes.label": "\u7A7A\u95F2\u5206\u949F\u6570",
  "settings.field.dream.idleMinutes.hint": "\u7A97\u53E3\u7A7A\u95F2\u6EE1\u8BE5\u5206\u949F\u6570\u5373\u5141\u8BB8 dream",
  "settings.field.dream.suppressWindows.label": "\u5CF0\u65F6\u6291\u5236\u65F6\u6BB5",
  "settings.field.dream.suppressWindows.hint": '"HH:MM-HH:MM" \u9017\u53F7\u5206\u9694\uFF1B\u8FD9\u4E9B\u65F6\u6BB5\u5185\u4E0D\u89E6\u53D1 dream',
  "settings.field.dream.suppressLeadMinutes.label": "\u5CF0\u65F6\u524D\u8FFD\u52A0\u6291\u5236\uFF08\u5206\u949F\uFF09",
  "settings.field.dream.checkMinutes.label": "\u68C0\u67E5\u5468\u671F\uFF08\u5206\u949F\uFF09",
  "settings.field.dream.timeZone.label": "\u6291\u5236\u65F6\u6BB5\u65F6\u533A",
  "settings.field.dream.timeZone.hint": "\u5CF0\u65F6\u7A97\u53E3\u6309\u6B64\u56FA\u5B9A\u65F6\u533A\u8BA1\u7B97\uFF08\u4E0E\u7CFB\u7EDF\u65F6\u949F\u65E0\u5173\uFF09",
  "settings.field.dream.rulesReviewDays.label": "\u51C6\u5219\u9632 churn \u5929\u6570",
  "settings.field.dream.rulesReviewDays.hint": "updated_at \u8DDD\u4ECA\u8D85\u8BE5\u5929\u6570\u7684\u7A33\u5B9A\u51C6\u5219\u4E0D\u8FDB dream \u7B2C 1 \u8F6E\uFF1B0=\u4E0D\u8FC7\u6EE4",
  "settings.field.promptLang.label": "prompt \u4E0E\u68C0\u7D22\u8BED\u8A00",
  "settings.field.promptLang.hint": "\u7559\u7A7A=\u9ED8\u8BA4 zh\uFF08\u672A\u914D\u7F6E\u8FC7\u7684\u4F1A\u8BDD\u4F1A\u6536\u5230\u4E00\u6B21\u9996\u7528\u5F15\u5BFC\uFF09\uFF1B'en'=\u5185\u7F6E\u82F1\u6587\u8BED\u8A00\u5305\u3002\u754C\u9762\u8BED\u8A00\u4E0E\u5B83\u65E0\u5173\u2014\u2014\u90A3\u7531 DSH \u7684\u8BED\u8A00\u8BBE\u7F6E\u51B3\u5B9A\u3002\u8BED\u8A00\u5FC5\u987B\u4E0E\u4F60\u8BF4\u7684\u8BDD\u4E00\u81F4\uFF0C\u5426\u5219\u5173\u952E\u8BCD\u547D\u4E2D\u7387\u4E0B\u964D",
  "settings.field.promptLang.placeholder": "zh / en",
  // ── 日期时间 ──────────────────────────────────────────────────────────────
  "datetime.ymd": "{m}\u6708{d}\u65E5",
  "datetime.ymdFull": "{y}\u5E74{m}\u6708{d}\u65E5"
};

// src/i18n/core.ts
var NS = "meow-memory";
var SUPPORTED_UI_LOCALES = [
  { id: "zh", label: "\u4E2D\u6587" },
  { id: "en", label: "English" }
];
var DICTS = {
  en,
  zh
};
var FALLBACK_CHAIN = {
  zh: ["zh", "en"],
  en: ["en"]
};
var DEFAULT_LOCALE = "zh";
var service = null;
var active = DEFAULT_LOCALE;
var registeredLocales = /* @__PURE__ */ new Set();
var registeredDicts = /* @__PURE__ */ new Set();
var listeners = /* @__PURE__ */ new Set();
var localeRetryMs = 1e3;
var localeRetryMax = 30;
var localeRetryTimer;
var localeRetryAttempts = 0;
function probeLocaleService(ctx) {
  const svc = typeof ctx?.get === "function" ? ctx.get("locale") : null;
  if (svc === null || svc === void 0 || typeof svc.getLocale !== "function" || typeof svc.register !== "function") return null;
  return svc;
}
function stopLocaleRetry() {
  if (localeRetryTimer !== void 0) clearTimeout(localeRetryTimer);
  localeRetryTimer = void 0;
  localeRetryAttempts = 0;
}
function armLocaleRetry(ctx, warn) {
  if (localeRetryTimer !== void 0) return;
  localeRetryAttempts = 0;
  const tick = () => {
    localeRetryTimer = void 0;
    localeRetryAttempts++;
    let svc = null;
    try {
      svc = probeLocaleService(ctx);
    } catch {
      svc = null;
    }
    if (svc !== null) {
      installI18n(ctx, warn);
      return;
    }
    if (localeRetryAttempts >= localeRetryMax) return;
    localeRetryTimer = setTimeout(tick, localeRetryMs);
  };
  localeRetryTimer = setTimeout(tick, localeRetryMs);
}
function normalize(tag) {
  return tag.trim().toLowerCase().replace(/_/g, "-");
}
function primary(tag) {
  return normalize(tag).split("-")[0];
}
function match(tag) {
  const wanted = normalize(tag);
  const exact = SUPPORTED_UI_LOCALES.find((l) => normalize(l.id) === wanted);
  if (exact !== void 0) return exact.id;
  const byPrimary = SUPPORTED_UI_LOCALES.find((l) => primary(l.id) === primary(wanted));
  return byPrimary !== void 0 ? byPrimary.id : null;
}
function browserLocale() {
  if (typeof navigator === "undefined") return null;
  const listed = [];
  if (Array.isArray(navigator.languages)) {
    for (const tag of navigator.languages) if (typeof tag === "string") listed.push(tag);
  }
  if (typeof navigator.language === "string") listed.push(navigator.language);
  for (const tag of listed) {
    const hit = match(tag);
    if (hit !== null) return hit;
  }
  return null;
}
function staticTranslate(locale, key, params) {
  const chain = FALLBACK_CHAIN[locale] ?? [locale, "en"];
  let template;
  for (const lang of chain) {
    const hit = DICTS[lang]?.[key];
    if (hit !== void 0) {
      template = hit;
      break;
    }
  }
  if (template === void 0) template = DICTS.en[key] ?? key;
  return fill(template, params);
}
function fill(template, params) {
  if (params === void 0) return template;
  let out = template;
  for (const [name, value] of Object.entries(params)) {
    out = out.replaceAll(`{${name}}`, () => String(value));
  }
  return out;
}
function installI18n(ctx, warn = (m) => console.warn(m)) {
  const svc = typeof ctx?.get === "function" ? ctx.get("locale") : null;
  if (svc === null || svc === void 0 || typeof svc.getLocale !== "function" || typeof svc.register !== "function") {
    service = null;
    active = browserLocale() ?? DEFAULT_LOCALE;
    notify();
    if (typeof ctx?.get === "function") armLocaleRetry(ctx, warn);
    else stopLocaleRetry();
    return [];
  }
  stopLocaleRetry();
  service = svc;
  const done = [];
  for (const locale of SUPPORTED_UI_LOCALES) {
    if (registeredLocales.has(locale.id)) {
      done.push(locale.id);
      continue;
    }
    try {
      if (locale.id === "zh" || locale.id === "en") {
        registeredLocales.add(locale.id);
        done.push(locale.id);
        continue;
      }
      if (typeof svc.addLanguage !== "function") continue;
      svc.addLanguage({ id: locale.id, label: locale.label, fallback: "en" });
      registeredLocales.add(locale.id);
      done.push(locale.id);
    } catch (error) {
      warn(`[meow-memory] \u8BED\u8A00 "${locale.id}" \u6CE8\u518C\u5931\u8D25\uFF08UI \u9000\u56DE\u82F1\u6587/\u4E2D\u6587\uFF09\uFF1A${String(error)}`);
    }
  }
  for (const locale of SUPPORTED_UI_LOCALES) {
    const dict = DICTS[locale.id];
    if (dict === void 0 || registeredDicts.has(locale.id)) continue;
    try {
      svc.register(NS, locale.id, { ...dict });
      registeredDicts.add(locale.id);
    } catch (error) {
      warn(`[meow-memory] \u754C\u9762\u5B57\u5178 "${locale.id}" \u6CE8\u518C\u5931\u8D25\uFF08\u8BE5\u8BED\u8A00\u9000\u56DE\u82F1\u6587\uFF09\uFF1A${String(error)}`);
    }
  }
  active = readServiceLocale();
  try {
    svc.subscribe(() => {
      const next = readServiceLocale();
      if (next === active) return;
      active = next;
      notify();
    });
  } catch (error) {
    warn(`[meow-memory] \u8BED\u8A00\u53D8\u5316\u8BA2\u9605\u5931\u8D25\uFF08\u6587\u6848\u5728\u5207\u6362\u8BED\u8A00\u524D\u4FDD\u6301\u5F53\u524D\u8BED\u8A00\uFF09\uFF1A${String(error)}`);
  }
  notify();
  return done;
}
function readServiceLocale() {
  try {
    const snapshot = service?.getLocale();
    const id = snapshot?.active;
    if (typeof id !== "string" || id === "") return DEFAULT_LOCALE;
    return match(id) ?? primary(id);
  } catch {
    return DEFAULT_LOCALE;
  }
}
function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(active);
    } catch (error) {
      console.error("[meow-memory] UI \u8BED\u8A00\u8BA2\u9605\u8005\u5F02\u5E38\uFF1A", error);
    }
  }
}
function onUiLocaleChange(fn) {
  listeners.add(fn);
  try {
    fn(active);
  } catch (error) {
    console.error("[meow-memory] UI \u8BED\u8A00\u8BA2\u9605\u8005\u5F02\u5E38\uFF1A", error);
  }
  return () => {
    listeners.delete(fn);
  };
}
var t = (key, params) => {
  if (service !== null) {
    try {
      const translate = service.bind(NS);
      const out = translate(key, params);
      if (out !== key) return out;
    } catch {
    }
  }
  return staticTranslate(active, key, params);
};

// src/source.ts
var PLUGIN_NAME = "meow-memory";
var PLUGIN_KIND = `plugin:${PLUGIN_NAME}`;
function isMeowSource(source) {
  if (source === null || typeof source !== "object") return false;
  const record = source;
  if (record.kind === PLUGIN_KIND) return true;
  return record.kind === "plugin" && record.plugin === PLUGIN_NAME;
}

// src/client-fold.ts
var REFLECT_MARKER = "[meow-memory-reflect]";
var DREAM_MARKER = "[meow-memory-dream]";
var META_SECTION_NAME = "__meta__";
function extractMetaFromSections(sections) {
  if (!Array.isArray(sections)) return void 0;
  const raw = sections.find((s) => s?.name === META_SECTION_NAME)?.text;
  if (raw === void 0) return void 0;
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function turnOf(node) {
  const location = node.location;
  if (location?.kind === "turn") return location.turn?.turn;
  if (location?.kind === "step") return location.turn?.turn;
  return void 0;
}
function contextText(node) {
  return blocksToText(node.data.content ?? []);
}
function isMemoryPrompt(node) {
  if (node.kind !== "context") return false;
  const source = node.data.source;
  if (!isMeowSource(source)) return false;
  const text = contextText(node);
  return text.includes(REFLECT_MARKER) || text.includes(DREAM_MARKER);
}
function variantOf(node) {
  const text = contextText(node);
  return text.includes(DREAM_MARKER) ? "dream" : "reflect";
}
function toolNameOf(node) {
  if (node.kind !== "tool-call") return void 0;
  const root = node.data.root;
  if (root === void 0) return void 0;
  if ("name" in root) return root.name;
  return root.call?.name;
}
function computeFoldGroups(snapshot) {
  if (snapshot?.chat === void 0) return [];
  const order = snapshot.chat.order;
  const nodes = snapshot.chat.nodes;
  const anchors = /* @__PURE__ */ new Map();
  for (const key of order) {
    const node = nodes.get(key);
    if (node === void 0 || !isMemoryPrompt(node)) continue;
    const turn = turnOf(node);
    if (turn === void 0) continue;
    const variant = variantOf(node);
    const mapKey = `${turn}:${variant}`;
    if (anchors.has(mapKey)) continue;
    anchors.set(mapKey, { key, turn, variant });
  }
  const groups = [];
  for (const anchor of anchors.values()) {
    const turnKeys = snapshot.chat.locations.getTurn(anchor.turn);
    const startIdx = turnKeys.indexOf(anchor.key);
    const ownsTurn = startIdx === 0;
    const keys = turnKeys.slice(startIdx === -1 ? 0 : startIdx).filter((k) => {
      const n = nodes.get(k);
      return n !== void 0 && n.kind !== "user" && n.kind !== "steering" && (n.kind !== "turn-tail" || ownsTurn);
    });
    let rememberCount = 0;
    let updateCount = 0;
    let status = "done";
    for (const k of keys) {
      const n = nodes.get(k);
      if (n === void 0) continue;
      const name = toolNameOf(n);
      if (name === "memory_remember") rememberCount++;
      else if (name === "memory_update") updateCount++;
      if (n.kind === "assistant") {
        const data = n.data;
        if (data.status === "running") status = "running";
        else if (data.status === "interrupted" && status !== "running") status = "interrupted";
      }
    }
    groups.push({ id: anchor.key, variant: anchor.variant, keys, rememberCount, updateCount, status });
  }
  return groups;
}
function memoryTurnNumbers(snapshot) {
  const out = /* @__PURE__ */ new Set();
  if (snapshot?.chat === void 0) return out;
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key);
    if (node === void 0 || !isMemoryPrompt(node)) continue;
    const turn = turnOf(node);
    if (turn !== void 0) out.add(turn);
  }
  return out;
}
function foldLabel(group, expanded) {
  const arrow = expanded ? "\u25BE" : "\u25B8";
  const title = t(group.variant === "dream" ? "fold.title.dream" : "fold.title.reflect");
  if (group.status === "running") {
    const hint = group.variant === "dream" ? t("fold.hint.running") : "";
    return `${arrow} ${t("fold.status.running", { title })}${hint}`;
  }
  if (group.status === "interrupted") return `${arrow} ${t("fold.status.interrupted", { title })}`;
  if (group.rememberCount > 0) return `${arrow} ${t("fold.status.remembered", { title, n: group.rememberCount })}`;
  if (group.updateCount > 0) return `${arrow} ${t("fold.status.updated", { title, n: group.updateCount })}`;
  return `${arrow} ${t("fold.status.nothing", { title })}`;
}
function toolCallDetail(block) {
  let args = block.argsRaw;
  try {
    args = JSON.stringify(JSON.parse(block.argsRaw), null, 2);
  } catch {
  }
  return args.length > 0 ? `${block.name}
${args}` : block.name;
}
function blocksToText(blocks) {
  return blocks.map((block) => block.text ?? "").join("\n").trim();
}
var FIRST_INJECTION_MARKER = "===== \u957F\u671F\u8BB0\u5FC6 =====";
var HIT_INJECTION_MARKER = "\u53EF\u80FD\u76F8\u5173\u7684\u8BB0\u5FC6\uFF0C\u4EC5\u4F9B\u53C2\u8003\uFF1A";
var PROMPT_SEPARATOR = "\u672C\u8F6E\u7528\u6237prompt\uFF1A";
var EN_PROMPT_SEPARATOR = "This turn's user prompt:";
function computeInjectionGroups(snapshot) {
  if (snapshot?.chat === void 0) return [];
  const groups = [];
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key);
    if (node === void 0) continue;
    if (node.kind === "context") {
      const ctx = node.data;
      const source = ctx.source;
      if (!isMeowSource(source)) continue;
      const meta = extractMetaFromSections(source.sections) ?? source.memory;
      const memKind = meta?.kind;
      if (memKind === "initial" || memKind === "reinjection") {
        groups.push({ id: key, kind: "first", injectedText: contextText(node) });
        continue;
      }
      if (memKind === "hit") {
        groups.push({ id: key, kind: "hit", injectedText: contextText(node) });
        continue;
      }
      if (meta !== void 0) continue;
      if (source.form === "snapshot") {
        const injectedText = contextText(node);
        const isFirst = injectedText.startsWith(FIRST_INJECTION_MARKER) || injectedText.includes("LONG-TERM MEMORY");
        groups.push({ id: key, kind: isFirst ? "first" : "hit", injectedText });
      }
      continue;
    }
    if (node.kind !== "user") continue;
    const content = node.data.content ?? [];
    if (content.length === 0 || content.some((b) => b.type !== "text")) continue;
    const text = blocksToText(content);
    if (text.length === 0) continue;
    let kind = null;
    if (text.startsWith(FIRST_INJECTION_MARKER) || text.includes("LONG-TERM MEMORY") || text.includes("===== \u957F\u671F\u8BB0\u5FC6 =====")) kind = "first";
    else if (text.startsWith(HIT_INJECTION_MARKER) || text.includes("Possibly relevant memories") || text.includes("\u53EF\u80FD\u76F8\u5173\u7684\u8BB0\u5FC6")) kind = "hit";
    if (kind === null) continue;
    const sep = text.includes(PROMPT_SEPARATOR) ? PROMPT_SEPARATOR : text.includes(EN_PROMPT_SEPARATOR) ? EN_PROMPT_SEPARATOR : null;
    if (sep === null) continue;
    const sepIdx = text.lastIndexOf(sep);
    const userText = text.slice(sepIdx + sep.length).replace(/^\n+/, "");
    const time = typeof node.data.time === "number" ? node.data.time : void 0;
    groups.push({ id: key, kind, injectedText: text.slice(0, sepIdx + sep.length), userText, time });
  }
  return groups;
}
function formatInjectionClock(time, now = Date.now()) {
  const d = new Date(time);
  const n = new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return clock;
  const md = d.getFullYear() === n.getFullYear() ? t("datetime.ymd", { m: d.getMonth() + 1, d: d.getDate() }) : t("datetime.ymdFull", { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
  return `${md} ${clock}`;
}

// src/client-delegate-vanish.ts
var DELEGATE_LABEL_PREFIX = "meow-memory ";
function isMeowDelegateLabel(label) {
  return typeof label === "string" && label.startsWith(DELEGATE_LABEL_PREFIX);
}
function indexSubagentDescendantCount(byId, rootId) {
  if (byId === void 0 || rootId === void 0) return 0;
  let total = 0;
  for (const descendant of Object.values(byId)) {
    if (descendant?.origin !== "subagent") continue;
    const seen = /* @__PURE__ */ new Set();
    let node = descendant;
    while (node?.origin === "subagent" && typeof node.parentId === "string" && !seen.has(node.id ?? "")) {
      seen.add(node.id ?? "");
      if (node.parentId === rootId) {
        total += 1;
        break;
      }
      node = byId[node.parentId];
    }
  }
  return total;
}
function computeVanishDecision(state) {
  const current = state?.current;
  const catalog = current === void 0 ? void 0 : state?.subagentsByParent?.[current];
  const entries = catalog?.state === "ready" ? (catalog.entries ?? []).filter((e) => e?.kind === "child") : [];
  if (catalog?.state !== "ready") {
    return { known: false, hideTrigger: false, mineCount: 0, othersCount: 0 };
  }
  const mine = entries.filter((e) => isMeowDelegateLabel(e.label));
  const others = entries.length - mine.length;
  const lineageTotal = indexSubagentDescendantCount(state?.byId, current);
  const hideTrigger = others === 0 && mine.length > 0 && lineageTotal <= mine.length;
  return { known: true, hideTrigger, mineCount: mine.length, othersCount: others };
}
var SENTINEL_ATTR = "data-meow-vanish";
var ROW_ATTR = "data-meow-vanish-row";
function locateLineageRoot(sentinel) {
  let scope = sentinel?.parentElement ?? null;
  for (let hop = 0; scope !== null && hop < 5; hop += 1, scope = scope.parentElement) {
    const candidates = scope.querySelectorAll(':scope [class*="_root"]');
    for (const candidate of Array.from(candidates)) {
      if (candidate.contains(sentinel ?? null)) continue;
      if (candidate.querySelector(':scope [class*="_trigger"]') !== null) return candidate;
    }
  }
  return null;
}
function vanishRows(root = document) {
  const rows = root.querySelectorAll('[role="treeitem"]');
  for (const row of Array.from(rows)) {
    const match2 = isMeowDelegateLabel(row.getAttribute("aria-label"));
    const marked = row.getAttribute(ROW_ATTR) === "1";
    if (match2 && !marked) {
      row.setAttribute(ROW_ATTR, "1");
      row.style.display = "none";
    } else if (!match2 && marked) {
      row.removeAttribute(ROW_ATTR);
      row.style.display = "";
    }
  }
}
function applyTriggerVisibility(root, hide) {
  if (root === null || root === void 0) return;
  const trigger = root.querySelector(':scope [class*="_trigger"]');
  if (trigger === null) return;
  const next = hide ? "none" : "";
  if (trigger.style.display !== next) trigger.style.display = next;
}
function applyVanishDom(decision, sentinel) {
  try {
    vanishRows();
    if (decision.known) applyTriggerVisibility(locateLineageRoot(sentinel), decision.hideTrigger);
  } catch (e) {
    console.warn("[meow-memory] vanish DOM \u5E94\u7528\u5931\u8D25\uFF08fail-open\uFF0C\u4FDD\u6301\u5B98\u65B9\u663E\u793A\uFF09\uFF1A", e);
  }
}
function startVanishObserver(getApply) {
  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const { decision, sentinel } = getApply();
      applyVanishDom(decision, sentinel);
    }, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
  };
}

// src/client-dream-events.ts
var listeners2 = /* @__PURE__ */ new Set();
var pollTimer = 0;
var lastStates = /* @__PURE__ */ new Map();
var lastSkipped = /* @__PURE__ */ new Set();
var lastScopes = /* @__PURE__ */ new Map();
var hasBaseline = false;
function emit(sessionId, state, detail) {
  for (const listener of [...listeners2]) {
    try {
      listener(detail === void 0 ? { sessionId, state } : { sessionId, state, ...detail });
    } catch {
    }
  }
}
async function pollDreamEventsOnce() {
  let states;
  let skipped;
  let scopes2;
  try {
    const [statesRes, skipRes] = await Promise.all([
      fetch("/meow-memory/dreamed-sessions", { cache: "no-store" }),
      fetch("/meow-memory/skip-dreams", { cache: "no-store" })
    ]);
    if (!statesRes.ok || !skipRes.ok) return;
    const statesData = await statesRes.json();
    const skipData = await skipRes.json();
    states = /* @__PURE__ */ new Map();
    if (Array.isArray(statesData.sessionIds)) {
      for (const id of statesData.sessionIds) if (typeof id === "string") states.set(id, "dreamed");
    }
    if (Array.isArray(statesData.dreamingIds)) {
      for (const id of statesData.dreamingIds) if (typeof id === "string") states.set(id, "dreaming");
    }
    skipped = /* @__PURE__ */ new Set();
    scopes2 = /* @__PURE__ */ new Map();
    if (Array.isArray(skipData.scopes)) {
      for (const sc of skipData.scopes) {
        if (typeof sc.sessionId !== "string") continue;
        scopes2.set(sc.sessionId, { dream: sc.dream === true, inject: sc.inject === true, write: sc.write === true });
      }
    } else if (Array.isArray(skipData.sessionIds)) {
      for (const id of skipData.sessionIds) if (typeof id === "string") skipped.add(id);
    }
    for (const id of skipped) if (!scopes2.has(id)) scopes2.set(id, { dream: true, inject: false, write: false });
  } catch {
    return;
  }
  if (!hasBaseline) {
    lastStates = states;
    lastSkipped = skipped;
    lastScopes = scopes2;
    hasBaseline = true;
    return;
  }
  for (const [sessionId, state] of states) {
    if (lastStates.get(sessionId) !== state) emit(sessionId, state);
  }
  for (const [sessionId, state] of lastStates) {
    if (!states.has(sessionId)) emit(sessionId, "active");
  }
  for (const sessionId of skipped) {
    if (!lastSkipped.has(sessionId)) emit(sessionId, "skip");
  }
  for (const sessionId of lastSkipped) {
    if (!skipped.has(sessionId)) emit(sessionId, "unskip");
  }
  for (const [sessionId, scope] of scopes2) {
    const prev = lastScopes.get(sessionId) ?? { dream: false, inject: false, write: false };
    for (const field of ["dream", "inject", "write"]) {
      if (scope[field] !== prev[field]) emit(sessionId, "scope", { field, value: scope[field] });
    }
  }
  for (const sessionId of lastScopes.keys()) {
    if (!scopes2.has(sessionId)) {
      const prev = lastScopes.get(sessionId);
      for (const field of ["dream", "inject", "write"]) {
        if (prev[field]) emit(sessionId, "scope", { field, value: false });
      }
    }
  }
  lastStates = states;
  lastSkipped = skipped;
  lastScopes = scopes2;
}
function subscribeDreamEvents(listener) {
  listeners2.add(listener);
  if (listeners2.size === 1 && pollTimer === 0) {
    pollTimer = window.setInterval(() => {
      void pollDreamEventsOnce();
    }, 6e4);
    void pollDreamEventsOnce();
  }
  return () => {
    listeners2.delete(listener);
    if (listeners2.size === 0 && pollTimer !== 0) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
  };
}

// src/client-i18n-replay.ts
var replayers = /* @__PURE__ */ new Set();
function registerUiReplayer(fn) {
  replayers.add(fn);
  return () => {
    replayers.delete(fn);
  };
}
function replayUiForLocale() {
  for (const fn of [...replayers]) {
    try {
      fn();
    } catch (error) {
      console.error("[meow-memory] UI \u8BED\u8A00\u91CD\u653E\u5931\u8D25\uFF1A", error);
    }
  }
}
onUiLocaleChange(() => {
  replayUiForLocale();
});

// src/client-delegate-notice.ts
var REFLECT_DELEGATE_MARKER = "\u3010\u8BB0\u5FC6\u53CD\u601D\u6807\u8BB0\u3011";
var REFLECT_DONE_DELEGATE_MARKER = "\u3010\u8BB0\u5FC6\u53CD\u601D\u5B8C\u6210\u6807\u8BB0\u3011";
var DREAM_DELEGATE_MARKER = "\u3010\u8BB0\u5FC6\u6574\u7406\u6807\u8BB0\u3011";
var HIDDEN_ATTR = "data-meow-delegate-hidden";
var ANCHOR_ATTR = "data-meow-delegate-anchor";
var CSS_ID = "meow-meow-delegate-notice-css";
var NOTICE_CSS = `[${HIDDEN_ATTR}="true"]{display:none!important}`;
var REFLECT_FRESH_MS = 30 * 6e4;
var DREAM_RUNNING_STALE_MS = 30 * 6e4;
var META_SECTION_NAME2 = "__meta__";
function extractMetaFromSections2(sections) {
  if (!Array.isArray(sections)) return void 0;
  const raw = sections.find((s) => s?.name === META_SECTION_NAME2)?.text;
  if (raw === void 0) return void 0;
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function noticeText(node) {
  const blocks = node.data?.content ?? [];
  return blocks.map((block) => block.text ?? "").join("\n").trim();
}
function delegateVariantOf(node) {
  if (node.kind !== "context") return void 0;
  const source = node.data?.source;
  if (source === void 0 || source === null || typeof source !== "object") return void 0;
  if (!isMeowSource(source)) return void 0;
  const meta = extractMetaFromSections2(source.sections) ?? source.memory;
  const memKind = meta?.kind;
  if (memKind === "reflect-marker") return "reflect";
  if (memKind === "reflect-done-marker") return "reflect-done";
  if (memKind === "dream-marker") return "dream";
  const text = noticeText(node);
  if (text.includes(REFLECT_DONE_DELEGATE_MARKER)) return "reflect-done";
  if (text.includes(REFLECT_DELEGATE_MARKER)) return "reflect";
  if (text.includes(DREAM_DELEGATE_MARKER)) return "dream";
  return void 0;
}
function delegateSessionIdOf(node) {
  const meta = extractMetaFromSections2(node.data?.source?.sections) ?? node.data?.source?.memory;
  const sid = meta?.sessionId;
  return typeof sid === "string" && sid !== "" ? sid : void 0;
}
function delegateTimeOf(node) {
  const time = node.data?.time;
  return typeof time === "number" ? time : void 0;
}
var dreamStateBySession = /* @__PURE__ */ new Map();
var lastApplied = [];
function delegateNoticeLabelFor(variant, running, interrupted = false) {
  if (variant === "dream") {
    if (interrupted) return t("notice.dream.interrupted");
    return running ? t("notice.dream.running") : t("notice.dream.done");
  }
  if (variant === "reflect-done") return t("notice.reflect.done");
  return running ? t("notice.reflect.running") : t("notice.reflect.done");
}
function delegateNoticeLabel(notice) {
  return delegateNoticeLabelFor(notice.variant, notice.running, notice.interrupted === true);
}
function computeDelegateNotices(snapshot, now = Date.now()) {
  if (snapshot?.chat === void 0) return [];
  const found = [];
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key);
    if (node === void 0) continue;
    const variant = delegateVariantOf(node);
    if (variant === void 0) continue;
    found.push({ key, variant, sessionId: delegateSessionIdOf(node), time: delegateTimeOf(node) });
  }
  let lastReflectIdx = -1;
  for (let i = 0; i < found.length; i++) {
    if (found[i].variant === "reflect" || found[i].variant === "reflect-done") lastReflectIdx = i;
  }
  const out = found.map((f, i) => {
    if (f.variant !== "dream") {
      return {
        id: f.key,
        variant: f.variant,
        sessionId: f.sessionId,
        running: f.variant === "reflect" && i === lastReflectIdx && f.time !== void 0 && now - f.time < REFLECT_FRESH_MS
      };
    }
    const state = f.sessionId !== void 0 ? dreamStateBySession.get(f.sessionId) : void 0;
    if (state === "dreaming") return { id: f.key, variant: f.variant, sessionId: f.sessionId, running: true };
    if (state === "dreamed") return { id: f.key, variant: f.variant, sessionId: f.sessionId, running: false };
    const stale = f.time !== void 0 && now - f.time >= DREAM_RUNNING_STALE_MS;
    return { id: f.key, variant: f.variant, sessionId: f.sessionId, running: !stale, interrupted: stale };
  });
  return out;
}
function ensureCss() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`style[data-plugin-css="${CSS_ID}"]`);
  if (existing !== null && existing.textContent === NOTICE_CSS) return;
  for (const stale of Array.from(document.querySelectorAll(`style[data-plugin-css="${CSS_ID}"]`))) {
    stale.remove();
  }
  const tag = document.createElement("style");
  tag.dataset.plugin = "meow-memory-delegate-notice";
  tag.dataset.pluginCss = CSS_ID;
  tag.textContent = NOTICE_CSS;
  document.head.appendChild(tag);
}
function applyDelegateNotices(groups) {
  if (typeof document === "undefined") return;
  lastApplied = groups;
  ensureCss();
  const containers = Array.from(document.querySelectorAll("[data-chat-flow]"));
  if (containers.length === 0) return;
  const liveIds = new Set(groups.map((group) => group.id));
  for (const container of containers) {
    for (const stale of Array.from(container.querySelectorAll(`[${ANCHOR_ATTR}]`))) {
      if (!liveIds.has(stale.getAttribute(ANCHOR_ATTR) ?? "")) stale.remove();
    }
    for (const row of Array.from(container.querySelectorAll(`[${HIDDEN_ATTR}]`))) {
      if (!liveIds.has(row.getAttribute("data-chat-flow-key") ?? "")) row.removeAttribute(HIDDEN_ATTR);
    }
    for (const group of groups) {
      const row = container.querySelector(`[data-chat-flow-key="${CSS.escape(group.id)}"]`);
      if (row === null || row.parentElement === null) continue;
      row.setAttribute(HIDDEN_ATTR, "true");
      if (group.variant === "reflect-done") continue;
      let anchor = container.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(group.id)}"]`);
      if (anchor === null) {
        anchor = document.createElement("div");
        anchor.setAttribute(ANCHOR_ATTR, group.id);
        row.parentElement.insertBefore(anchor, row);
      }
      let bubble = anchor.querySelector(":scope > [data-meow-delegate-bubble]");
      if (bubble === null) {
        bubble = document.createElement("div");
        bubble.setAttribute("data-meow-delegate-bubble", "true");
        bubble.style.cssText = [
          "display:block;margin:4px 0;padding:5px 12px;",
          "font-size:12px;line-height:1.6;text-align:left;",
          "color:var(--dsw-alias-label-secondary, rgba(127,127,127,.9));",
          "background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.14);",
          "border-radius:999px;"
        ].join("");
        anchor.appendChild(bubble);
      }
      const label = delegateNoticeLabel(group);
      if (bubble.textContent !== label) bubble.textContent = label;
    }
  }
}
function startDelegateStateSync() {
  if (typeof window === "undefined") return () => {
  };
  const notify2 = () => {
    if (lastApplied.length > 0) applyDelegateNotices(lastApplied);
  };
  const refresh = async () => {
    try {
      const response = await fetch("/meow-memory/dreamed-sessions", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      dreamStateBySession.clear();
      if (Array.isArray(data.sessionIds)) {
        for (const id of data.sessionIds) if (typeof id === "string") dreamStateBySession.set(id, "dreamed");
      }
      if (Array.isArray(data.dreamingIds)) {
        for (const id of data.dreamingIds) if (typeof id === "string") dreamStateBySession.set(id, "dreaming");
      }
      notify2();
    } catch {
    }
  };
  const unsubscribeDreamEvents = subscribeDreamEvents((event) => {
    const { sessionId, state } = event;
    if (state === "dreaming" || state === "dreamed") dreamStateBySession.set(sessionId, state);
    else dreamStateBySession.delete(sessionId);
    notify2();
  });
  void refresh();
  const unregisterReplay = registerUiReplayer(notify2);
  return () => {
    unregisterReplay();
    unsubscribeDreamEvents();
    dreamStateBySession.clear();
    lastApplied = [];
  };
}

// src/client-dream-icon.ts
var DREAM_ICON_ATTR = "data-meow-dreamed";
var DREAMING_ATTR = "data-meow-dreaming";
var SKIPPED_ATTR = "data-meow-skip-dream";
var MOON_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
var SKIP_MOON_PATH = "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z";
var SKIP_SLASH_PATH = "M2.5 2.5l19 19";
function makeSkipMoonSvg() {
  const id = `meow-skip-${Math.random().toString(36).slice(2, 10)}`;
  return `<svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><defs><mask id="${id}"><rect width="24" height="24" fill="#fff"/><path d="${SKIP_SLASH_PATH}" fill="none" stroke="#000" stroke-width="4.4" stroke-linecap="round"/></mask></defs><g mask="url(#${id})"><path fill="currentColor" d="${SKIP_MOON_PATH}"/></g><path d="${SKIP_SLASH_PATH}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}
var ICON_CSS = `[${DREAM_ICON_ATTR}],
[${DREAMING_ATTR}],
[${SKIPPED_ATTR}] {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  margin-right: 4px; /* \u69FD\u4F4D\u5185\u5C45\u72B6\u6001\u70B9\u5DE6\u4FA7 / flat \u884C\u9996\u5185\u8054\uFF1A\u4E0E\u53F3\u4FA7\u5185\u5BB9\u4FDD\u6301\u95F4\u8DDD */
}
[${DREAM_ICON_ATTR}] { color: #e9c46a; opacity: 0.9; } /* \u6DE1\u9EC4\u505C\u9A7B */
[${DREAMING_ATTR}] {
  color: #f2c14e;
  animation: meow-dream-breathe 2.4s ease-in-out infinite;
}
@keyframes meow-dream-breathe {
  0%, 100% { color: #fff8e6; opacity: 0.55; }
  50% { color: #f2c14e; opacity: 1; }
}
[${SKIPPED_ATTR}] { color: #94a3b8; opacity: 0.85; } /* \u9759\u97F3\u7070\uFF1A\u8FD9\u6247\u7A97\u4E0D\u505A\u68A6 */
`;
var FIBER_KEY_RE = /^__reactFiber\$/;
function readSessionId(row) {
  let fiber = null;
  for (const key of Object.keys(row)) {
    if (FIBER_KEY_RE.test(key)) {
      fiber = row[key];
      break;
    }
  }
  let cur = fiber;
  for (let depth = 0; depth < 8 && cur !== null && cur !== void 0; depth++) {
    const f = cur;
    if (typeof f.key === "string" && f.key.length > 0) return f.key;
    cur = f.return;
  }
  return null;
}
function makeIcon(state) {
  const icon = document.createElement("span");
  icon.setAttribute(attrForState(state) ?? DREAM_ICON_ATTR, "true");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = state === "skipped" ? makeSkipMoonSvg() : MOON_SVG;
  return icon;
}
function attrForState(state) {
  if (state === "dreaming") return DREAMING_ATTR;
  if (state === "dreamed") return DREAM_ICON_ATTR;
  if (state === "skipped") return SKIPPED_ATTR;
  return null;
}
var ANY_ICON_SEL = `[${DREAM_ICON_ATTR}], [${DREAMING_ATTR}], [${SKIPPED_ATTR}]`;
var SESSION_ROWS_SEL = 'div[role="treeitem"][class*="_sessionRow"]';
function mergeIconStates(dreamStates, skippedIds) {
  const merged = /* @__PURE__ */ new Map();
  for (const [id, state] of dreamStates) merged.set(id, state);
  for (const id of skippedIds) {
    if (merged.get(id) !== "dreaming") merged.set(id, "skipped");
  }
  return merged;
}
function applyDreamIcons(states, rows) {
  const all = rows ?? document.querySelectorAll(SESSION_ROWS_SEL);
  for (const row of all) {
    const id = readSessionId(row);
    const state = id !== null ? states.get(id) : void 0;
    const wantAttr = attrForState(state);
    const slot = row.querySelector('[class$="_slot"]');
    if (slot !== null) {
      const cur = slot.querySelector(ANY_ICON_SEL);
      const consistent = cur !== null && wantAttr !== null && cur.getAttribute(wantAttr) === "true";
      if (state !== void 0 && !consistent) {
        cur?.remove();
        slot.insertBefore(makeIcon(state), slot.firstChild);
      } else if (state === void 0 && cur !== null) {
        cur.remove();
      }
    } else if (state !== void 0) {
      const cur = row.querySelector(ANY_ICON_SEL);
      const consistent = cur !== null && cur.getAttribute(wantAttr ?? "") === "true";
      if (!consistent) {
        cur?.remove();
        const icon = makeIcon(state);
        icon.setAttribute("data-meow-inline-icon", "true");
        row.insertBefore(icon, row.firstChild);
      }
    } else {
      row.querySelector(ANY_ICON_SEL)?.remove();
    }
  }
}
function startDreamIconManager() {
  const dreamStates = /* @__PURE__ */ new Map();
  const skippedIds = /* @__PURE__ */ new Set();
  let timer = 0;
  const replay = () => applyDreamIcons(mergeIconStates(dreamStates, skippedIds));
  const refreshSkips = async () => {
    try {
      const response = await fetch("/meow-memory/skip-dreams", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      skippedIds.clear();
      if (Array.isArray(data.scopes)) {
        for (const sc of data.scopes) {
          if (typeof sc.sessionId !== "string") continue;
          if (sc.dream === true) skippedIds.add(sc.sessionId);
        }
      } else if (Array.isArray(data.sessionIds)) {
        for (const id of data.sessionIds) {
          if (typeof id === "string") skippedIds.add(id);
        }
      }
    } catch {
    }
  };
  const refresh = async () => {
    try {
      const response = await fetch("/meow-memory/dreamed-sessions", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      dreamStates.clear();
      if (Array.isArray(data.sessionIds)) {
        for (const id of data.sessionIds) {
          if (typeof id === "string") dreamStates.set(id, "dreamed");
        }
      }
      if (Array.isArray(data.dreamingIds)) {
        for (const id of data.dreamingIds) {
          if (typeof id === "string") dreamStates.set(id, "dreaming");
        }
      }
    } catch {
    }
    await refreshSkips();
    replay();
  };
  const unsubscribeDreamEvents = subscribeDreamEvents((event) => {
    const { sessionId, state } = event;
    if (state === "scope") return;
    if (state === "dreamed" || state === "dreaming") dreamStates.set(sessionId, state);
    else if (state === "skip") skippedIds.add(sessionId);
    else if (state === "unskip") skippedIds.delete(sessionId);
    else dreamStates.delete(sessionId);
    replay();
  });
  for (const stale of Array.from(document.querySelectorAll("style[data-meow-dream-icon-css]"))) {
    stale.remove();
  }
  const style = document.createElement("style");
  style.dataset.meowDreamIconCss = "true";
  style.dataset.plugin = "meow-memory";
  style.textContent = ICON_CSS;
  document.head.appendChild(style);
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(replay, 120);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  void refresh();
  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
    unsubscribeDreamEvents();
    style.remove();
    for (const el of Array.from(document.querySelectorAll(`[${DREAM_ICON_ATTR}], [${DREAMING_ATTR}], [${SKIPPED_ATTR}]`))) el.remove();
  };
}

// src/client-dream-skip.ts
var SKIP_ITEM_ATTR = "data-meow-skip-item";
var ROW_ACTIONS_SEL = '[class*="_rowActions"]';
var SESSION_ROW_SEL = '[role="treeitem"][class*="_sessionRow"]';
var MENU_OPEN_ROW_SEL = '[role="treeitem"][class*="_sessionRow"][class*="_menuOpen"]';
var MENU_WINDOW_MS = 1500;
var PART_STATE_KEYS = {
  active: "part.state.active",
  writeonly: "part.state.writeonly",
  readonly: "part.state.readonly",
  exited: "part.state.exited"
};
function participationState(scope) {
  const { dream, inject: inject2 } = scope;
  if (!inject2 && !dream) return "active";
  if (inject2 && !dream) return "writeonly";
  if (!inject2 && dream) return "readonly";
  return "exited";
}
function participationLabel(scope) {
  return `${t("part.menu")} \xB7 ${t(PART_STATE_KEYS[participationState(scope)])}`;
}
function captureSessionIdFromTarget(target) {
  const el = target;
  if (el === null || el === void 0 || typeof el.closest !== "function") return null;
  if (el.closest(ROW_ACTIONS_SEL) === null) return null;
  const row = el.closest(SESSION_ROW_SEL);
  if (row === null) return null;
  return readSessionId(row);
}
function retitleLeaf(root, text) {
  let leaf = null;
  const walk = (el) => {
    let hasElementChild = false;
    for (const c of el.children) {
      hasElementChild = true;
      walk(c);
    }
    if (!hasElementChild && (el.textContent ?? "").trim().length > 0) leaf = el;
  };
  walk(root);
  if (leaf === null) return false;
  leaf.textContent = text;
  return true;
}
function resolveMenuSessionId(doc, fallback) {
  const openRow = doc.querySelector(MENU_OPEN_ROW_SEL);
  if (openRow === null) return null;
  const sid = readSessionId(openRow);
  return sid !== null ? sid : fallback;
}
var scopes = /* @__PURE__ */ new Map();
function readScope(sid) {
  return scopes.get(sid) ?? { dream: false, inject: false, write: false };
}
function writeScopeField(sid, field, val) {
  const cur = readScope(sid);
  cur[field] = val;
  scopes.set(sid, cur);
}
function injectSkipItem(menu, sessionId, host) {
  for (const old of Array.from(menu.querySelectorAll(`[${SKIP_ITEM_ATTR}]`))) {
    if (old.getAttribute("data-meow-session-id") === sessionId) return null;
    old.remove();
  }
  const template = menu.querySelector('[role="menuitem"]');
  if (template === null) return null;
  const item = template.cloneNode(true);
  item.removeAttribute("id");
  for (const el of Array.from(item.querySelectorAll("[id]"))) el.removeAttribute("id");
  item.setAttribute("role", "menuitem");
  if (!retitleLeaf(item, participationLabel(readScope(sessionId)))) return null;
  item.setAttribute(SKIP_ITEM_ATTR, "true");
  item.setAttribute("data-meow-session-id", sessionId);
  const icon = item.querySelector("svg");
  if (icon !== null) icon.outerHTML = MOON_SVG;
  const onClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    host.onOpen(sessionId, item);
  };
  item.addEventListener("click", onClick, true);
  item.addEventListener("pointerdown", (e) => e.stopPropagation());
  menu.appendChild(item);
  return item;
}
var openPanel = null;
var openPanelMenu = null;
var outsideCloseHandler = null;
var escapeCloseHandler = null;
var panelRerender = null;
function closeScopePanel() {
  if (openPanel === null) return;
  openPanel.remove();
  openPanel = null;
  if (openPanelMenu !== null) {
    try {
      openPanelMenu.style.visibility = "";
    } catch {
    }
  }
  openPanelMenu = null;
  if (outsideCloseHandler !== null) document.removeEventListener("pointerdown", outsideCloseHandler, true);
  if (escapeCloseHandler !== null) document.removeEventListener("keydown", escapeCloseHandler, true);
  outsideCloseHandler = null;
  escapeCloseHandler = null;
  panelRerender = null;
}
function buildScopePanel(sid, post) {
  const panel = document.createElement("div");
  panel.setAttribute("data-meow-scope-panel", "true");
  panel.style.cssText = "position:fixed;z-index:2147483647;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px 8px 6px;font-size:12px;line-height:1.6;min-width:276px;box-shadow:0 8px 24px rgba(0,0,0,0.45);font-family:inherit;";
  const rerender = () => renderRows(sid);
  panelRerender = rerender;
  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;gap:12px;";
  const titleText = document.createElement("span");
  titleText.textContent = t("part.menu");
  const close = document.createElement("span");
  close.textContent = "\u2715";
  close.style.cssText = "cursor:pointer;opacity:0.7;padding:0 3px;";
  close.addEventListener("click", () => closeScopePanel());
  title.append(titleText, close);
  panel.appendChild(title);
  const rows = [
    { field: "inject", key: "part.panel.inject" },
    { field: "dream", key: "part.panel.consolidate" }
  ];
  const rowEls = [];
  for (const { field, key } of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:16px;padding:5px 6px;border-radius:4px;cursor:pointer;white-space:nowrap;";
    row.addEventListener("pointerenter", () => {
      row.style.background = "rgba(128,128,128,0.18)";
    });
    row.addEventListener("pointerleave", () => {
      row.style.background = "transparent";
    });
    row.addEventListener("click", () => {
      const next = !readScope(sid)[field];
      writeScopeField(sid, field, next);
      post(field, next);
      rerender();
      syncOpenMenuLabels();
    });
    const label = document.createElement("span");
    label.textContent = t(key);
    const state = document.createElement("span");
    state.style.cssText = "white-space:nowrap;";
    row.append(label, state);
    panel.appendChild(row);
    rowEls.push({ el: row, field, state });
  }
  function renderRows(sid2) {
    const cur = readScope(sid2);
    for (const { field, state } of rowEls) {
      const on = cur[field];
      state.textContent = on ? t("part.panel.off") : t("part.panel.on");
      state.style.cssText = on ? "opacity:0.55;" : "color:#93c5fd;";
    }
  }
  renderRows(sid);
  return panel;
}
function openScopePanel(sid, anchor, post) {
  closeScopePanel();
  const menu = anchor.closest('[role="menu"]');
  const panel = buildScopePanel(sid, post);
  document.body.appendChild(panel);
  const rect = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  let left = rect.right + 6;
  if (left + pw > window.innerWidth - 8) left = Math.max(8, rect.left - pw - 6);
  let top = rect.top;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
  panel.style.left = `${Math.max(8, left)}px`;
  panel.style.top = `${Math.max(8, top)}px`;
  openPanel = panel;
  openPanelMenu = menu;
  if (menu !== null) menu.style.visibility = "hidden";
  outsideCloseHandler = (e) => {
    if (openPanel !== null && !openPanel.contains(e.target)) closeScopePanel();
  };
  escapeCloseHandler = (e) => {
    if (e.key === "Escape") closeScopePanel();
  };
  document.addEventListener("pointerdown", outsideCloseHandler, true);
  document.addEventListener("keydown", escapeCloseHandler, true);
}
function syncOpenMenuLabels() {
  for (const item of Array.from(document.querySelectorAll(`[${SKIP_ITEM_ATTR}]`))) {
    const sid = item.getAttribute("data-meow-session-id");
    if (sid !== null) retitleLeaf(item, participationLabel(readScope(sid)));
  }
}
function startDreamSkipManager() {
  let pendingSid = null;
  let pendingAt = 0;
  let observerTimer = 0;
  const syncOpenMenus = () => {
    const withinWindow = pendingSid !== null && Date.now() - pendingAt <= MENU_WINDOW_MS;
    const sid = resolveMenuSessionId(document, withinWindow ? pendingSid : null);
    if (sid === null) return;
    for (const menu of Array.from(document.querySelectorAll('[role="menu"]'))) {
      injectSkipItem(menu, sid, { onOpen: handleOpen });
    }
  };
  const observer = new MutationObserver((muts) => {
    if (pendingSid !== null && Date.now() - pendingAt <= MENU_WINDOW_MS) {
      const sid = resolveMenuSessionId(document, pendingSid);
      if (sid !== null) {
        for (const m of muts) {
          for (const node of Array.from(m.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue;
            const menus = node.matches('[role="menu"]') ? [node] : Array.from(node.querySelectorAll('[role="menu"]'));
            for (const menu of menus) injectSkipItem(menu, sid, { onOpen: handleOpen });
          }
        }
        for (const menu of Array.from(document.querySelectorAll('[role="menu"]'))) {
          injectSkipItem(menu, sid, { onOpen: handleOpen });
        }
      }
    }
    window.clearTimeout(observerTimer);
    observerTimer = window.setTimeout(syncOpenMenus, 120);
  });
  const handlePost = (sessionId, field, value) => {
    void (async () => {
      try {
        const resp = await fetch("/meow-memory/skip-dreams", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, field, value })
        });
        if (!resp.ok) throw new Error(String(resp.status));
      } catch {
        writeScopeField(sessionId, field, !value);
        panelRerender?.();
        syncOpenMenuLabels();
      }
    })();
  };
  const handleOpen = (sessionId, item) => {
    openScopePanel(sessionId, item, (field, value) => {
      handlePost(sessionId, field, value);
    });
  };
  const onPointerDown = (e) => {
    const sid = captureSessionIdFromTarget(e.target);
    if (sid === null) return;
    pendingSid = sid;
    pendingAt = Date.now();
  };
  const refresh = async () => {
    try {
      const response = await fetch("/meow-memory/skip-dreams", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      scopes.clear();
      if (Array.isArray(data.scopes)) {
        for (const sc of data.scopes) {
          if (typeof sc.sessionId !== "string") continue;
          scopes.set(sc.sessionId, { dream: sc.dream === true, inject: sc.inject === true, write: sc.write === true });
        }
      } else if (Array.isArray(data.sessionIds)) {
        for (const id of data.sessionIds) {
          if (typeof id === "string") scopes.set(id, { dream: true, inject: false, write: false });
        }
      }
      syncOpenMenuLabels();
    } catch {
    }
  };
  const unsubscribeDreamEvents = subscribeDreamEvents((event) => {
    const { sessionId, state } = event;
    if (state === "scope" && (event.field === "dream" || event.field === "inject" || event.field === "write")) {
      writeScopeField(sessionId, event.field, event.value === true);
    } else if (state === "skip") {
      writeScopeField(sessionId, "dream", true);
    } else if (state === "unskip") {
      writeScopeField(sessionId, "dream", false);
    } else {
      return;
    }
    syncOpenMenuLabels();
    panelRerender?.();
  });
  document.addEventListener("pointerdown", onPointerDown, true);
  observer.observe(document.body, { childList: true, subtree: true });
  void refresh();
  const unregisterReplay = registerUiReplayer(() => {
    syncOpenMenuLabels();
  });
  return () => {
    unregisterReplay();
    closeScopePanel();
    document.removeEventListener("pointerdown", onPointerDown, true);
    observer.disconnect();
    window.clearTimeout(observerTimer);
    unsubscribeDreamEvents();
    for (const item of Array.from(document.querySelectorAll(`[${SKIP_ITEM_ATTR}]`))) item.remove();
    for (const el of Array.from(document.querySelectorAll("[data-meow-scope-panel]"))) el.remove();
  };
}

// src/client-menu-dream.ts
var MENU_SELECTOR = "[data-trigger-menu]";
var ROW_ID_PREFIX = "dsh-slash-option-command-";
var DREAM_SHORT = "\u624B\u52A8\u5524\u8D77\u4E00\u6B21\u8BB0\u5FC6\u6574\u7406";
var DREAM_LABEL = "\u8BB0\u5FC6\u6574\u7406";
var DREAM_LONG_PREFIX = "\u624B\u52A8\u5524\u8D77\u4E00\u6B21\u8BB0\u5FC6\u6574\u7406\uFF08dream\uFF09";
var OFFICIAL_ALIASES = ["compact", "model", "export", "permission", "goal", "plan", "feedback"];
var MOON_SVG2 = '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><path fill="currentColor" d="M279.135 512c78.756 0 150.982-35.804 198.844-94.775 28.27-34.831-2.558-85.722-46.249-77.401-82.348 15.683-158.272-47.268-158.272-130.792 0-48.424 26.06-92.292 67.434-115.836 38.745-22.05 28.999-80.788-15.022-88.919A257.936 257.936 0 0 0 279.135 0c-141.36 0-256 114.575-256 256 0 141.36 114.576 256 256 256zm0-464c12.985 0 25.689 1.201 38.016 3.478-54.76 31.163-91.693 90.042-91.693 157.554 0 113.848 103.641 199.2 215.252 177.944C402.574 433.964 344.366 464 279.135 464c-114.875 0-208-93.125-208-208s93.125-208 208-208z"/></svg>';
function findDreamRow(menu) {
  const rows = menu.querySelectorAll(`button[id^="${ROW_ID_PREFIX}"]`);
  for (const row of rows) {
    for (const span of row.querySelectorAll(":scope > span")) {
      if (span.textContent === "dream") return row;
    }
  }
  return null;
}
function officialIconClass(menu) {
  const svg = menu.querySelector(`button[id^="${ROW_ID_PREFIX}"] > span > svg`);
  const span = svg?.parentElement;
  if (span === null || span === void 0 || span.className.length === 0) return null;
  return span.className;
}
function officialAliasClass(menu) {
  const spans = menu.querySelectorAll(`button[id^="${ROW_ID_PREFIX}"] > span`);
  for (const name of OFFICIAL_ALIASES) {
    for (const span of spans) {
      if (span.textContent === name && span.className.length > 0) return span.className;
    }
  }
  return null;
}
function decorateRow(row, iconClass, aliasClass) {
  const spans = row.querySelectorAll(":scope > span");
  let nameSpan = null;
  let descriptionSpan = null;
  const aliasSpan = row.querySelector(":scope > span[data-meow-dream-alias]");
  for (const span of spans) {
    if (span === aliasSpan) {
      nameSpan = aliasSpan.previousElementSibling;
      continue;
    }
    if (span.textContent === "dream" && nameSpan === null) nameSpan = span;
    else if ((span.textContent?.length ?? 0) > 4 && span !== nameSpan) descriptionSpan = span;
  }
  if (nameSpan === null) return;
  if (nameSpan.textContent === "dream") nameSpan.textContent = DREAM_LABEL;
  if (aliasSpan === null) {
    const alias = document.createElement("span");
    alias.setAttribute("data-meow-dream-alias", "1");
    if (aliasClass !== null) alias.className = aliasClass;
    else alias.style.cssText = "opacity:.55;font-size:.9em;";
    alias.textContent = "dream";
    nameSpan.parentElement?.insertBefore(alias, nameSpan.nextSibling);
  }
  const prev = nameSpan.previousElementSibling;
  if (prev === null || !prev.hasAttribute("data-meow-dream-face")) {
    const icon = document.createElement("span");
    icon.setAttribute("data-meow-dream-face", "1");
    if (iconClass !== null) icon.className = iconClass;
    else icon.style.cssText = "display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;";
    icon.innerHTML = MOON_SVG2;
    nameSpan.parentElement?.insertBefore(icon, nameSpan);
  }
  if (descriptionSpan !== null && descriptionSpan !== nameSpan && descriptionSpan.textContent?.startsWith(DREAM_LONG_PREFIX) === true) {
    descriptionSpan.textContent = DREAM_SHORT;
  }
}
function startMenuDreamFace() {
  if (typeof document === "undefined") return () => {
  };
  let scheduled = false;
  const decorate = () => {
    scheduled = false;
    try {
      const menu = document.querySelector(MENU_SELECTOR);
      if (menu === null) return;
      const row = findDreamRow(menu);
      if (row === null) return;
      decorateRow(row, officialIconClass(menu), officialAliasClass(menu));
    } catch {
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(decorate);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
  return () => {
    observer.disconnect();
  };
}

// src/client.ts
var FOLDED_ATTR = "data-meow-memory-folded";
var ANCHOR_ATTR2 = "data-meow-memory-anchor";
var BODY_ATTR = "data-meow-memory-body";
var INJ_ANCHOR_ATTR = "data-meow-injection-anchor";
var INJ_BODY_ATTR = "data-meow-injection-body";
var INJ_PROMPT_ATTR = "data-meow-injection-prompt";
var FOLD_CSS = `[${FOLDED_ATTR}="true"] { display: none !important; }
[data-meow-detail-body] {
  display: none;
  margin: 2px 0 8px 22px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-secondary, rgba(190,190,190,.9));
  background: rgba(127,127,127,.06);
  border: 1px solid rgba(127,127,127,.12);
  border-radius: 8px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace;
}
[data-meow-detail-body="think"] {
  font-family: inherit;
  font-style: italic;
  opacity: .9;
}
[${INJ_BODY_ATTR}] {
  display: none;
  margin: 2px 0 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-secondary, rgba(190,190,190,.9));
  background: rgba(127,127,127,.05);
  border: 1px solid rgba(127,127,127,.12);
  border-radius: 8px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace;
}
[${INJ_PROMPT_ATTR}] {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
/* \u7528\u6237 prompt \u6C14\u6CE1\uFF1A\u6837\u5F0F\u5BF9\u9F50 dsh \u672C\u4F53 UserStyleBubble\uFF08MessageItem.module.css
 * .userStack/.bubble\uFF09\u2014\u2014\u540C token \u540C\u5C3A\u5BF8\uFF0C\u4E3B\u9898\u5207\u6362\u81EA\u52A8\u8DDF\u968F\u3002 */
[${INJ_PROMPT_ATTR}] > [data-meow-inj-bubble] {
  max-width: min(525px, 82%);
  padding: 10px 16px;
  border-radius: 22px;
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-word;
}
[data-meow-inj-actions] {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  background: transparent;
}
[data-meow-inj-time] {
  padding-right: 12px;
  font-size: 14px;
  line-height: 24px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  background: transparent;
}
@media (hover: hover) {
  [data-meow-inj-time] {
    opacity: 0;
    transition: opacity 80ms ease;
  }
  [${INJ_PROMPT_ATTR}]:hover [data-meow-inj-time],
  [${INJ_PROMPT_ATTR}]:focus-within [data-meow-inj-time] {
    opacity: 1;
  }
}
[data-meow-inj-copy] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
[data-meow-inj-copy]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}`;
var bodySigs = /* @__PURE__ */ new Map();
function sigOf(container, keys) {
  return keys.map((key) => flowRow(container, key)?.textContent ?? "").join("");
}
function flowRow(container, key) {
  return container.querySelector(`[data-chat-flow-key="${CSS.escape(key)}"]`);
}
function anchorOf(container, id) {
  return container.querySelector(`[${ANCHOR_ATTR2}="${CSS.escape(id)}"]`);
}
function ensureAnchor(container, group, expanded, onToggle) {
  let anchor = anchorOf(container, group.id);
  if (anchor === null) {
    const startRow = flowRow(container, group.id);
    if (startRow === null || startRow.parentElement === null) return;
    anchor = document.createElement("div");
    anchor.setAttribute(ANCHOR_ATTR2, group.id);
    startRow.parentElement.insertBefore(anchor, startRow);
  }
  let bar = anchor.querySelector(":scope > button");
  if (bar === null) {
    bar = document.createElement("button");
    bar.type = "button";
    bar.style.cssText = [
      "display:block;width:100%;margin:4px 0;padding:5px 12px;",
      "font-size:12px;line-height:1.6;text-align:left;cursor:pointer;",
      "color:var(--dsw-alias-label-secondary, rgba(127,127,127,.9));",
      "background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.14);",
      "border-radius:999px;"
    ].join("");
    bar.addEventListener("click", () => onToggle(group.id));
    anchor.appendChild(bar);
  }
  const label = foldLabel(group, expanded);
  if (bar.textContent !== label) bar.textContent = label;
  const hint = t(expanded ? "inject.collapse" : "inject.expand");
  if (bar.title !== hint) bar.title = hint;
  let body = anchor.querySelector(`:scope > [${BODY_ATTR}]`);
  if (body === null) {
    body = document.createElement("div");
    body.setAttribute(BODY_ATTR, "true");
    body.style.display = "none";
    body.style.cssText = [
      "display:none;",
      "background:rgba(127,127,127,.05);",
      "border:1px solid rgba(127,127,127,.12);",
      "border-radius:12px;",
      "margin:2px 0 6px;",
      "padding:6px 10px;",
      "max-height:70vh;",
      "overflow-y:auto;"
    ].join("");
    anchor.appendChild(body);
  }
}
function attachDisclosure(rowEl, label, text) {
  const root = rowEl.parentElement;
  if (root === null) return;
  if (root.querySelector(":scope > [data-meow-detail-body]") !== null) return;
  const body = document.createElement("div");
  body.setAttribute("data-meow-detail-body", label);
  body.textContent = text;
  body.style.display = "none";
  root.appendChild(body);
  rowEl.addEventListener("click", () => {
    const open = root.getAttribute("data-open") === "true";
    root.setAttribute("data-open", open ? "" : "true");
    body.style.display = open ? "none" : "block";
  });
}
function enhanceClone(clone, node) {
  if (node === void 0) return;
  if (node.kind === "assistant-step") {
    const blocks = node.data.blocks ?? [];
    const reasoning = blocks.filter((b) => b.kind === "reasoning");
    const toolCalls = blocks.filter((b) => b.kind === "tool-call");
    const thinkRows = Array.from(clone.querySelectorAll('[data-variant="think"]'));
    thinkRows.forEach((root, i) => {
      const text = reasoning[i]?.text;
      const rowEl = root.querySelector("[data-disclosure-row]");
      if (text !== void 0 && rowEl !== null) attachDisclosure(rowEl, "think", text);
    });
    const toolRows = Array.from(clone.querySelectorAll("[data-disclosure-row]")).filter((el) => el.closest('[data-variant="think"]') === null);
    toolRows.forEach((rowEl, i) => {
      const block = toolCalls[i];
      if (block !== void 0) attachDisclosure(rowEl, "tool", toolCallDetail(block));
    });
  } else if (node.kind === "tool-call") {
    const root = node.data.root;
    if (root === void 0) return;
    const rowEl = clone.querySelector("[data-disclosure-row]");
    if (rowEl === null) return;
    const name = "name" in root ? root.name : root.call?.name ?? root.callId;
    const argsRaw = "name" in root ? root.argsRaw : root.call?.argsRaw ?? "";
    const detail = toolCallDetail({ name, argsRaw });
    const resultText = "content" in root ? blocksToText(root.content) : "";
    attachDisclosure(rowEl, "tool", resultText.length > 0 ? `${detail}

${t("inject.result")}
${resultText}` : detail);
  } else if (node.kind === "context") {
    const content = node.data.content;
    const text = blocksToText(content ?? []);
    const rowEl = clone.querySelector("[data-disclosure-row]");
    if (rowEl !== null && text.length > 0) attachDisclosure(rowEl, "context", text);
  }
}
function fillBody(id, visible, keys, session) {
  for (const container of Array.from(document.querySelectorAll("[data-chat-flow]"))) {
    const anchor = anchorOf(container, id);
    if (anchor === null) continue;
    const body = anchor.querySelector(`:scope > [${BODY_ATTR}]`);
    if (body === null) continue;
    body.replaceChildren();
    if (!visible) {
      body.style.display = "none";
      bodySigs.delete(id);
      return;
    }
    body.style.display = "block";
    for (const key of keys) {
      const row = flowRow(container, key);
      if (row === null) continue;
      const clone = row.cloneNode(true);
      clone.removeAttribute(FOLDED_ATTR);
      clone.removeAttribute("data-chat-flow-key");
      clone.removeAttribute("data-chat-anchor-key");
      clone.removeAttribute("data-chat-flow-kind");
      body.appendChild(clone);
      enhanceClone(clone, session.chat?.nodes.get(key));
    }
    bodySigs.set(id, sigOf(container, keys));
  }
}
var COPY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z" fill="currentColor"/></svg>';
var CHECK_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z" fill="currentColor"/></svg>';
async function copyInjectionText(button, text) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    textarea.remove();
  }
  if (!ok || button.dataset.meowInjState === "copied") return;
  button.dataset.meowInjState = "copied";
  button.title = t("inject.copied");
  button.innerHTML = CHECK_ICON_SVG;
  window.setTimeout(() => {
    button.dataset.meowInjState = "copy";
    button.title = t("inject.copy");
    button.innerHTML = COPY_ICON_SVG;
  }, 1e3);
}
function applyInjectionFold(groups, expanded, onToggle) {
  const containers = Array.from(document.querySelectorAll("[data-chat-flow]"));
  if (containers.length === 0) return;
  const liveIds = new Set(groups.map((g) => g.id));
  for (const container of containers) {
    for (const stale of Array.from(container.querySelectorAll(`[${INJ_ANCHOR_ATTR}]`))) {
      if (!liveIds.has(stale.getAttribute(INJ_ANCHOR_ATTR) ?? "")) stale.remove();
    }
    for (const group of groups) {
      const startRow = flowRow(container, group.id);
      if (startRow === null || startRow.parentElement === null) continue;
      startRow.setAttribute(FOLDED_ATTR, "true");
      let anchor = container.querySelector(`[${INJ_ANCHOR_ATTR}="${CSS.escape(group.id)}"]`);
      if (anchor === null) {
        anchor = document.createElement("div");
        anchor.setAttribute(INJ_ANCHOR_ATTR, group.id);
        startRow.parentElement.insertBefore(anchor, startRow);
      }
      let bar = anchor.querySelector(":scope > button");
      if (bar === null) {
        bar = document.createElement("button");
        bar.type = "button";
        bar.style.cssText = [
          "display:block;margin:4px 0 4px auto;max-width:82%;padding:5px 12px;",
          "font-size:12px;line-height:1.6;text-align:left;cursor:pointer;",
          "color:var(--dsw-alias-label-secondary, rgba(127,127,127,.9));",
          "background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.14);",
          "border-radius:999px;"
        ].join("");
        bar.addEventListener("click", () => onToggle(group.id));
        anchor.appendChild(bar);
      }
      const kindLabel = t(group.kind === "first" ? "inject.kind.first" : "inject.kind.hit");
      const label = `${expanded.has(group.id) ? "\u25BE" : "\u25B8"} ${t("inject.bar")}${kindLabel}`;
      if (bar.textContent !== label) bar.textContent = label;
      let body = anchor.querySelector(`:scope > [${INJ_BODY_ATTR}]`);
      if (body === null) {
        body = document.createElement("div");
        body.setAttribute(INJ_BODY_ATTR, "true");
        anchor.appendChild(body);
      }
      if (expanded.has(group.id)) {
        if (body.textContent !== group.injectedText) body.textContent = group.injectedText;
        body.style.display = "block";
      } else {
        body.style.display = "none";
      }
      let prompt = anchor.querySelector(`:scope > [${INJ_PROMPT_ATTR}]`);
      if (group.userText === void 0) {
        prompt?.remove();
        continue;
      }
      if (prompt === null) {
        prompt = document.createElement("div");
        prompt.setAttribute(INJ_PROMPT_ATTR, "true");
        const bubble2 = document.createElement("div");
        bubble2.dataset.meowInjBubble = "true";
        prompt.appendChild(bubble2);
        const actions = document.createElement("div");
        actions.dataset.meowInjActions = "true";
        const timeLabel2 = document.createElement("span");
        timeLabel2.dataset.meowInjTime = "true";
        actions.appendChild(timeLabel2);
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.dataset.meowInjCopy = "true";
        copyButton.title = t("inject.copy");
        copyButton.setAttribute("aria-label", t("inject.copy"));
        copyButton.innerHTML = COPY_ICON_SVG;
        copyButton.addEventListener("click", () => {
          if (group.userText !== void 0) {
            void copyInjectionText(copyButton, group.userText);
          }
        });
        actions.appendChild(copyButton);
        prompt.appendChild(actions);
        anchor.appendChild(prompt);
      }
      const bubble = prompt.querySelector(":scope > [data-meow-inj-bubble]");
      if (bubble !== null && bubble.textContent !== group.userText) bubble.textContent = group.userText;
      const timeLabel = prompt.querySelector(":scope > [data-meow-inj-actions] > [data-meow-inj-time]");
      if (timeLabel !== null) {
        const label2 = group.time === void 0 ? "" : formatInjectionClock(group.time);
        if (timeLabel.textContent !== label2) timeLabel.textContent = label2;
        if (label2 === "") timeLabel.style.display = "none";
        else if (timeLabel.style.display !== "") timeLabel.style.display = "";
      }
    }
  }
}
function applyFoldState(groups, expanded, onToggle, session) {
  const containers = Array.from(document.querySelectorAll("[data-chat-flow]"));
  if (containers.length === 0) return;
  const liveIds = new Set(groups.map((group) => group.id));
  for (const container of containers) {
    for (const stale of Array.from(container.querySelectorAll(`[${ANCHOR_ATTR2}]`))) {
      if (!liveIds.has(stale.getAttribute(ANCHOR_ATTR2) ?? "")) stale.remove();
    }
    for (const group of groups) {
      for (const key of group.keys) {
        const row = flowRow(container, key);
        if (row === null) continue;
        row.setAttribute(FOLDED_ATTR, "true");
      }
      ensureAnchor(container, group, expanded.has(group.id), onToggle);
      if (expanded.has(group.id)) {
        const sig = sigOf(container, group.keys);
        if (bodySigs.get(group.id) !== sig) fillBody(group.id, true, group.keys, session);
      } else {
        bodySigs.delete(group.id);
      }
    }
  }
}
var TURN_NAV_FRAME_VAR = "--turn-rail-inset";
function applyTurnNavHiding(memoryTurns) {
  if (memoryTurns.size === 0) return;
  for (const nav of document.querySelectorAll("nav[style]")) {
    if (nav.style.getPropertyValue(TURN_NAV_FRAME_VAR) === "") continue;
    for (const btn of nav.querySelectorAll("button[aria-label]")) {
      const nums = (btn.getAttribute("aria-label") ?? "").match(/\d+/g);
      if (nums === null) continue;
      const turn = Number(nums[nums.length - 1]);
      const slot = btn.parentElement;
      if (Number.isInteger(turn) && memoryTurns.has(turn) && slot !== null) slot.style.display = "none";
    }
  }
}
var chatIdentity = (chat) => chat;
function MemoryFoldDock(props) {
  const useChat = props?.useChat;
  const chatViaHook = typeof useChat === "function" ? useChat(chatIdentity) : void 0;
  const legacySession = props?.session;
  const snapshot = chatViaHook !== void 0 ? { chat: chatViaHook } : legacySession !== null && typeof legacySession === "object" && legacySession.chat !== void 0 ? legacySession : void 0;
  const [expanded, setExpanded] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const [injExpanded, setInjExpanded] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const groups = (0, import_react.useMemo)(() => computeFoldGroups(snapshot), [snapshot]);
  const injGroups = (0, import_react.useMemo)(() => computeInjectionGroups(snapshot), [snapshot]);
  const dgNotices = (0, import_react.useMemo)(() => computeDelegateNotices(snapshot), [snapshot]);
  const memTurns = (0, import_react.useMemo)(() => memoryTurnNumbers(snapshot), [snapshot]);
  const toggle = (0, import_react.useCallback)((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const willExpand = !next.has(id);
      if (willExpand) next.add(id);
      else next.delete(id);
      const group = groups.find((candidate) => candidate.id === id);
      fillBody(id, willExpand, group?.keys ?? [], snapshot);
      return next;
    });
  }, [groups, snapshot]);
  const toggleInj = (0, import_react.useCallback)((id) => {
    setInjExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  (0, import_react.useLayoutEffect)(() => {
    applyFoldState(groups, expanded, toggle, snapshot);
    applyInjectionFold(injGroups, injExpanded, toggleInj);
    applyDelegateNotices(dgNotices);
    applyTurnNavHiding(memTurns);
  }, [groups, expanded, toggle, snapshot, injGroups, injExpanded, toggleInj, dgNotices, memTurns]);
  const latest = (0, import_react.useRef)({ groups, expanded, toggle, snapshot, injGroups, injExpanded, toggleInj, dgNotices, memTurns });
  latest.current = { groups, expanded, toggle, snapshot, injGroups, injExpanded, toggleInj, dgNotices, memTurns };
  (0, import_react.useEffect)(() => {
    let timer = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        applyFoldState(latest.current.groups, latest.current.expanded, latest.current.toggle, latest.current.snapshot);
        applyInjectionFold(latest.current.injGroups, latest.current.injExpanded, latest.current.toggleInj);
        applyDelegateNotices(latest.current.dgNotices);
        applyTurnNavHiding(latest.current.memTurns);
      }, 80);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  (0, import_react.useEffect)(() => {
    return onUiLocaleChange(() => {
      applyFoldState(latest.current.groups, latest.current.expanded, latest.current.toggle, latest.current.snapshot);
      applyInjectionFold(latest.current.injGroups, latest.current.injExpanded, latest.current.toggleInj);
      applyDelegateNotices(latest.current.dgNotices);
    });
  }, []);
  return null;
}
function makeDelegateVanishDock(refreshSubagents) {
  return function DelegateVanishDock({ useSessions }) {
    const current = useSessions?.((state) => state?.current);
    const byId = useSessions?.((state) => state?.byId);
    const catalogs = useSessions?.((state) => state?.subagentsByParent);
    const sentinelRef = (0, import_react.useRef)(null);
    const decision = (0, import_react.useMemo)(
      () => computeVanishDecision({ current, byId, subagentsByParent: catalogs }),
      [current, byId, catalogs]
    );
    const latest = (0, import_react.useRef)({ decision });
    latest.current = { decision };
    (0, import_react.useLayoutEffect)(() => {
      applyVanishDom(decision, sentinelRef.current);
    }, [decision]);
    (0, import_react.useEffect)(() => {
      if (current !== void 0 && typeof refreshSubagents === "function") {
        try {
          refreshSubagents(current);
        } catch {
        }
      }
      return startVanishObserver(() => ({ decision: latest.current.decision, sentinel: sentinelRef.current }));
    }, [current]);
    return (0, import_react.createElement)("span", {
      [SENTINEL_ATTR]: "1",
      style: { display: "none" },
      ref: sentinelRef
    });
  };
}
var inject = ["slots", "sessions", "remote.settings"];
function apply(ctx) {
  const disposers = [];
  try {
    installI18n(ctx);
  } catch (e) {
    console.warn("[meow-memory] \u6587\u6848\u5C42\u521D\u59CB\u5316\u5931\u8D25\uFF08UI \u9000\u56DE\u9ED8\u8BA4\u8BED\u8A00\uFF09\uFF1A", e);
  }
  disposers.push(startDreamIconManager());
  disposers.push(startDelegateStateSync());
  disposers.push(startDreamSkipManager());
  disposers.push(startMenuDreamFace());
  for (const stale of Array.from(document.querySelectorAll("style[data-meow-memory-css]"))) {
    stale.remove();
  }
  const style = document.createElement("style");
  style.dataset.meowMemoryCss = "true";
  style.dataset.plugin = "meow-memory";
  style.textContent = FOLD_CSS;
  document.head.appendChild(style);
  const slots = ctx?.slots;
  if (slots === void 0 || typeof slots.inject !== "function") {
    console.warn("[meow-memory] slots service unavailable; reflection folding disabled");
  } else {
    disposers.push(slots.inject("conversation.composer.dock", () => slots.register(
      {
        name: "conversation.composer.dock",
        id: "meow-memory",
        order: 90
      },
      MemoryFoldDock
    )));
    const sessions = ctx?.sessions;
    const refreshSubagents = typeof sessions?.refreshSubagents === "function" ? (id) => sessions.refreshSubagents(id) : void 0;
    disposers.push(slots.inject("conversation.session.header.actions", () => slots.register(
      {
        name: "conversation.session.header.actions",
        id: "meow-memory",
        order: 200
      },
      makeDelegateVanishDock(refreshSubagents)
    )));
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
      }
    }
  };
}

    return module.exports;
  }
});
