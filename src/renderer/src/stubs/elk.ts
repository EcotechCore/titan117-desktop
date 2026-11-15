/**
 * Mermaid's optional ELK layout, replaced at build time (decisions §44):
 * elkjs is EPL-2.0 or GPL-3.0, so none of it ships. Diagrams use Mermaid's
 * own layouts; asking for `layout: elk` fails with this message instead.
 */
export default class ELK {
  layout(): Promise<never> {
    return Promise.reject(new Error('The ELK layout is not included in Titan117.'))
  }
}
