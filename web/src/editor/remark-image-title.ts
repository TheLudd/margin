import type { Root } from 'mdast'

interface Node {
  type: string
  title?: string | null
  children?: Node[]
}

// Milkdown's image nodes (and Crepe's image blocks, which take their caption
// from the title) require a string title, but remark gives `null` for images
// written without one. Unpatched, the image or linked badge fails to load and
// is dropped from the document.
export function remarkImageTitle() {
  return (tree: Root) => fixTitles(tree)
}

function fixTitles(node: Node) {
  if (node.type === 'image' || node.type === 'image-block') node.title ??= ''
  node.children?.forEach(fixTitles)
}
