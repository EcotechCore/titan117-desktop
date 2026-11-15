// A tiny MCP server for the connector tests: one tool that reads, one that sends.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'test-crm', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_customers',
      description: 'List customers',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'send_email',
      description: 'Send an email',
      inputSchema: {
        type: 'object',
        properties: { to: { type: 'string' }, body: { type: 'string' } },
        required: ['to', 'body']
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {}
  if (request.params.name === 'list_customers')
    return {
      content: [
        {
          type: 'text',
          text: `Ana Pop (${args.city ?? 'Cluj'}), secret ${process.env.CRM_TOKEN ? 'present' : 'missing'}`
        }
      ]
    }
  return { content: [{ type: 'text', text: `sent to ${args.to}` }] }
})

await server.connect(new StdioServerTransport())
