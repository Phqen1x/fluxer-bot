// Parses a user's message into actions. Anyone who messages the bot gets their own CSS and
// their own URL (see css-store.js) — userId is always whoever actually sent the message.
//   !css <description>            generate/modify CSS from natural language
//   !css new <description>        start from scratch
//   !css undo | redo | reset | show | list | link
//   !css save <name> [--upload] | load <name> | delete <name>
//   !ai <anything>                let the local LLM choose the action
export async function handle(text, prefix, { actions, plan }, userId) {
  const body = text.slice(prefix.length).trim();
  const [cmd, ...rest] = body.split(/\s+/);
  const arg = rest.join(' ');
  const ctx = { userId };

  if (cmd === 'ai') {
    if (!arg) return 'Usage: `!ai <what you want>`';
    const { action, args } = await plan(arg);
    return `_(${action})_\n` + await actions[action].run(args, ctx);
  }
  if (cmd !== 'css') return null; // not for us

  const [sub, ...subRest] = rest;
  const name = subRest.find((w) => !w.startsWith('--'));
  switch (sub) {
    case undefined: case 'help':
      return 'Commands: `!css <describe the look>`, `!css new <…>`, `undo`, `redo`, `reset`, `show`, `list`, `link`, `save <name> [--upload]`, `load <name>`, `delete <name>`, or `!ai <anything>`.';
    case 'undo': return actions.undo_css.run({}, ctx);
    case 'redo': return actions.redo_css.run({}, ctx);
    case 'reset': return actions.reset_css.run({}, ctx);
    case 'show': return actions.show_css.run({}, ctx);
    case 'list': return actions.list_profiles.run({}, ctx);
    case 'link': case 'url': return actions.my_link.run({}, ctx);
    case 'save': return actions.save_profile.run({ name, upload: subRest.includes('--upload') }, ctx);
    case 'load': return actions.load_profile.run({ name }, ctx);
    case 'delete': return actions.delete_profile.run({ name }, ctx);
    case 'new': return actions.set_css.run({ description: subRest.join(' '), fresh: true }, ctx);
    default: return actions.set_css.run({ description: arg }, ctx);
  }
}
