package ai.tokenroll.toolbridge.mobile

import org.junit.Assert.*
import org.junit.Test

class SemanticTreeReaderTest {
    private val scope = SemanticScope("epoch", "owner", "allowed", 19)

    private class Node(
        val title: String, val children: List<Node?> = emptyList(), val pkg: String = "allowed",
        val window: Int = 19, val password: Boolean = false, val sensitive: Boolean = false,
        val visible: Boolean = true, val refreshable: Boolean = true
    ) {
        var acquired = 0
        var released = 0
        var read = false
    }

    private val reader = object : SemanticTreeReader<Node>() {
        override fun refresh(node: Node) = node.refreshable
        override fun describe(node: Node, index: Int): SemanticNode? {
            if (!scope.permitsNode(node.window, node.pkg, node.visible, node.password, node.sensitive)) return null
            node.read = true
            return SemanticNode(index, "View", "", "", node.title, SemanticBox(0, 0, 500, 500),
                emptyList(), false, false, false, false, emptyList())
        }
        override fun count(node: Node) = node.children.size
        override fun child(node: Node, index: Int) = node.children[index]?.also { it.acquired++ }
        override fun release(node: Node) { node.released++ }
    }

    @Test fun redactionPrecedesReadingLabelsChildrenAndCapturingHandles() {
        val secret = Node("secret")
        val hidden = listOf(Node("password", listOf(secret), password = true),
            Node("sensitive", listOf(secret), sensitive = true),
            Node("foreign", listOf(secret), pkg = "not.allowed"),
            Node("other-window", listOf(secret), window = 20),
            Node("offscreen", listOf(secret), visible = false))
        val visible = Node("公开资料")
        val root = Node("", hidden + visible)
        val captured = mutableListOf<Node>()
        val layout = reader.read(root) { _, child -> captured.add(child) }
        assertEquals(listOf(root, visible), captured)
        assertTrue(hidden.all { !it.read && it.acquired == 1 && it.released == 1 })
        assertEquals(0, secret.acquired)
        assertEquals(0, root.released)
        assertEquals(1, visible.released)
        assertEquals(listOf("公开资料"), layout.regions.single().items.map { it.identity.name })
    }

    @Test fun exceptionsReleaseEveryOwnedHandleAndLeaveBorrowedRootWithCaller() {
        val leaf = Node("leaf")
        val parent = Node("parent", listOf(leaf))
        val root = Node("root", listOf(parent))
        assertThrows(IllegalStateException::class.java) {
            reader.read(root) { _, node -> if (node === leaf) error("stop") }
        }
        assertEquals(1, leaf.released)
        assertEquals(1, parent.released)
        assertEquals(0, root.released)
    }

    @Test fun vanishedAndUnrefreshableNodesAreMissingEvidence() {
        val vanished = Node("stale", refreshable = false)
        val layout = reader.read(Node("", listOf(null, vanished))) { _, _ -> }
        assertTrue(layout.incompleteTree)
        assertTrue(layout.regions.single().incomplete)
        assertFalse(vanished.read)
        assertEquals(1, vanished.released)
        assertThrows(WireFailure::class.java) {
            reader.read(Node("root", refreshable = false)) { _, _ -> }
        }
    }

    @Test fun wideAndDeepProviderTreesStopAtBoundariesAndReleaseHandles() {
        val children = List(500) { Node("row") }
        val wide = reader.read(Node("", children)) { _, _ -> }
        assertTrue(wide.incompleteTree)
        assertEquals(256, children.sumOf { it.acquired })
        assertEquals(256, children.sumOf { it.released })
        var chain = Node("end")
        repeat(40) { chain = Node("nested", listOf(chain)) }
        assertTrue(reader.read(chain) { _, _ -> }.incompleteTree)
    }
}
