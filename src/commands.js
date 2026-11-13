// Parses owner messages into actions.
//   !css <description>            generate/modify CSS from natural language
//   !css new <description>        start from scratch
//   !css undo | reset | show | list
//   !css save <name> [--upload] | load <name> | delete <name>
//   !ai <anything>                let the local LLM choose the action
export async function handle(text, prefix, { actions, plan }) {
  const body = text.slice(prefix.length).trim();
  const [cmd, ...rest] = body.split(/\s+/);
  const arg = rest.join(' ');

  if (cmd === 'ai') {
    if (!arg) return 'Usage: `!ai <what you want>`';
    const { action, args } = await plan(arg);
    return `_(${action})_\n` + await actions[action].run(args);
  }
  if (cmd !== 'css') return null; // not for us

  const [sub, ...subRest] = rest;
  const name = subRest.find((w) => !w.startsWith('--'));
  switch (sub) {
    case undefined: case 'help':
      return 'Commands: `!css <describe the look>`, `!css new <…>`, `undo`, `reset`, `show`, `list`, `save <name> [--upload]`, `load <name>`, `delete <name>`, or `!ai <anything>`.';
    case 'undo': return actions.undo_css.run({});
    case 'reset': return actions.reset_css.run({});
    case 'show': return actions.show_css.run({});
    case 'list': return actions.list_profiles.run({});
    case 'save': return actions.save_profile.run({ name, upload: subRest.includes('--upload') });
    case 'load': return actions.load_profile.run({ name });
    case 'delete': return actions.delete_profile.run({ name });
    case 'new': return actions.set_css.run({ description: subRest.join(' '), fresh: true });
    default: return actions.set_css.run({ description: arg });
  }
}
