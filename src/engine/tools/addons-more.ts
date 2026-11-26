/**
 * The rest of phase 16's tools (decisions §66.21–66.23): add-ons from a
 * folder (larger tools the coding engine wrote), any open-source project
 * downloaded for setup with the user's OK, and publishing an add-on to the
 * user's own GitHub. Only Titan has them (`addons: 'manage'`).
 */
import { defineTool } from './lib/define-tool'

export const addonsInstallFolder = defineTool<{ folder: string }>({
  name: 'addons_install_folder',
  description: [
    'Install an add-on from a folder in the allowed folders: a titan.json and the files it names.',
    'Use it for larger tools the coding engine wrote (code_task into a folder, then this), or an agent, skill, MCP server or workflow made there.',
    'It reads the folder, runs the same checks as for GitHub (a tool is loaded in the sandbox first), and the user approves the card on the laptop.'
  ].join(' '),
  params: {
    type: 'object',
    properties: { folder: { type: 'string', description: 'The folder with titan.json.' } },
    required: ['folder']
  },
  risk: 'read',
  permissions: { addons: 'manage', folders: 'read' },
  laptopOnly: true,
  describe: (input) => `Install the add-on in ${String(input.folder).slice(0, 160)}`,
  // Reading the folder asks nothing; the install itself asks with the card, in run.
  assess: (input) => ({
    risk: 'read',
    summary: `Read the add-on in ${String(input.folder).slice(0, 160)}`
  }),
  async run(input, ctx) {
    const { files, card, title } = await ctx.addons.readFolder(String(input.folder))
    if (!(await ctx.ask(card)))
      return { output: `The user didn’t install ${title}.`, summary: `Not installed: ${title}` }
    const addon = await ctx.addons.installFolder(files)
    return {
      output: `Installed ${addon.title} (version ${addon.versions.length}).`,
      summary: `Installed ${addon.title} from a folder`
    }
  }
})

export const projectDownload = defineTool<{ address: string; folder: string }>({
  name: 'project_download',
  description: [
    'Install any open-source project (10.5), step one: download a GitHub or GitLab repository at its newest commit (or owner/repo@commit) into a new folder in the allowed folders.',
    'Nothing in it runs. You get its licence, a dependency and key check, the file list and its README and setup files, as outside content.',
    'Then propose the setup steps to the user in plain words, and run each command only with their OK (commands ask as usual).'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'owner/repo, a GitHub address, or gitlab.com/group/project'
      },
      folder: { type: 'string', description: 'A new, empty folder inside the allowed folders.' }
    },
    required: ['address', 'folder']
  },
  risk: 'write',
  permissions: { addons: 'manage', network: true, folders: 'write' },
  untrustedOutput: true,
  describe: (input) =>
    `Download ${String(input.address).slice(0, 120)} into ${String(input.folder).slice(0, 120)} (nothing in it runs)`,
  async run(input, ctx) {
    const got = await ctx.addons.download(String(input.address), String(input.folder))
    const c = got.checks
    const vulnerable = c.dependencies.vulnerable
    return {
      output: [
        `Downloaded ${got.key} into ${got.folder}. Nothing was run.`,
        `Licence: ${c.licence.note}`,
        c.dependencies.error
          ? `Dependency scan couldn’t run: ${c.dependencies.error}`
          : `Dependencies: ${vulnerable.length} of ${c.dependencies.checked} pinned npm packages have known vulnerabilities${
              vulnerable.length
                ? ` (${vulnerable
                    .slice(0, 5)
                    .map((v) => `${v.name} ${v.version}`)
                    .join(', ')})`
                : ''
            }.`,
        c.secrets.length
          ? `Keys found: ${c.secrets
              .slice(0, 5)
              .map((s) => `${s.rule} in ${s.file}`)
              .join('; ')}.`
          : 'No keys found.',
        c.installScripts.length
          ? `Install scripts (they run when someone installs its packages): ${c.installScripts.join('; ')}.`
          : '',
        `Files (${c.files}): ${got.files.slice(0, 120).join(', ')}`,
        ...got.texts.map((t) => `--- ${t.path} ---\n${t.text}`)
      ]
        .filter(Boolean)
        .join('\n\n'),
      summary: `Downloaded ${got.key}`
    }
  }
})

export const addonsPublish = defineTool<{ name: string; repo_name: string; licence?: string }>({
  name: 'addons_publish',
  description: [
    'Share an add-on made on this laptop (a tool Titan made, or one installed from a folder) as a new public repository in the user’s own GitHub account, as the user.',
    'It writes its files, a licence (MIT by default, or Apache-2.0, or none) and a README. The user then adds the topic titan117-addon on the repository’s GitHub page so the marketplace lists it.',
    'Needs the user signed in with GitHub on the Code screen. Asks every time, on the laptop.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The add-on’s name, from addons_list.' },
      repo_name: {
        type: 'string',
        description: 'The new repository’s name, like ron-rates-titan117.'
      },
      licence: {
        type: 'string',
        description: 'MIT (default), Apache-2.0 or none.',
        enum: ['MIT', 'Apache-2.0', 'none']
      }
    },
    required: ['name', 'repo_name']
  },
  risk: 'external',
  permissions: { addons: 'manage', network: true },
  laptopOnly: true,
  describe: (input) =>
    `Publish the add-on ${String(input.name).slice(0, 60)} as the public GitHub repository ${String(input.repo_name).slice(0, 100)}`,
  assess: (input) => ({
    risk: 'external',
    summary: `Publish the add-on ${String(input.name).slice(0, 60)} as a new public GitHub repository “${String(input.repo_name).slice(0, 100)}” in your account, with the ${input.licence ?? 'MIT'} licence. Anyone will be able to read its code.`,
    alwaysAsks: true
  }),
  async run(input, ctx) {
    const licence =
      input.licence === 'Apache-2.0' || input.licence === 'none' ? input.licence : 'MIT'
    const { url } = await ctx.addons.publish(String(input.name), String(input.repo_name), licence)
    return {
      output: `Published at ${url}. For the marketplace to list it, open that page, click the gear next to “About” and add the topic titan117-addon (Titan117’s GitHub App can’t set topics).`,
      summary: `Published ${String(input.name)} to ${url}`
    }
  }
})

export const moreAddonTools = [addonsInstallFolder, projectDownload, addonsPublish]
