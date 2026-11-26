package ai.tokenroll.toolbridge.mobile

import org.json.JSONObject

internal fun scopedReceipt(dispatch: String, outcome: String, resolution: String? = null): JSONObject =
    JSONObject().put("v", 2).put("dispatch", dispatch).put("outcome", outcome).put("resolution", resolution)

/** Every predicate is an edge between two complete observations of the same authorized window. */
internal sealed class ScopedExpectation {
    abstract fun changed(before: JSONObject, after: JSONObject): Boolean
    open fun evidence(): JSONObject? = null

    fun verified(before: JSONObject, after: JSONObject): Boolean =
        before.getString("kind") == "full" && after.getString("kind") == "full" &&
            !before.getBoolean("truncated") && !after.getBoolean("truncated") &&
            before.getJSONObject("window").getString("ref") == after.getJSONObject("window").getString("ref") &&
            changed(before, after)

    class Visible(private val role: String, private val name: String) : ScopedExpectation() {
        override fun changed(before: JSONObject, after: JSONObject) =
            before.matches(role, name).isEmpty() && after.matches(role, name).size == 1
        override fun evidence(): JSONObject = JSONObject().put("role", role).put("name", name)
    }

    class Transition(private val from: String, private val to: String, private val name: String) : ScopedExpectation() {
        override fun changed(before: JSONObject, after: JSONObject): Boolean {
            val old = before.matches(from, name).singleOrNull() ?: return false
            val new = after.matches(to, name).singleOrNull() ?: return false
            return old.getString("region") == new.getString("region") &&
                before.matches(to, name).isEmpty() && after.matches(from, name).isEmpty()
        }
        override fun evidence(): JSONObject = JSONObject().put("role", to).put("name", name)
    }

    class RegionChanged(val region: String) : ScopedExpectation() {
        override fun changed(before: JSONObject, after: JSONObject): Boolean {
            fun rows(frame: JSONObject): List<List<String>>? {
                val section = frame.rows("regions").singleOrNull { it.getString("ref") == region } ?: return null
                val header = listOf("label", "position", "bounds", "actions").map { section.get(it).toString() }
                val items = frame.rows("items").filter { it.getString("region") == region }.map { item ->
                    listOf("role", "name", "context", "bounds", "actions").map { item.get(it).toString() } +
                        listOf(item.optBoolean("enabled", true).toString(), item.optBoolean("selected").toString())
                }
                return listOf(header) + items
            }
            val old = rows(before) ?: return false
            val new = rows(after) ?: return false
            return old != new
        }
    }

    companion object {
        fun parse(args: JSONObject): ScopedExpectation? {
            if (!args.has("expect")) return null
            val expect = args.objectField("expect")
            if (expect.length() != 1) invalidWire()
            return when {
                expect.has("visible") -> expect.objectField("visible").let {
                    it.only("role", "name")
                    Visible(it.string("role"), it.string("name"))
                }
                expect.has("transition") -> expect.objectField("transition").let {
                    it.only("fromRole", "toRole", "name")
                    Transition(it.string("fromRole"), it.string("toRole"), it.string("name"))
                }
                expect.has("regionChanged") -> RegionChanged(expect.string("regionChanged"))
                else -> invalidWire()
            }
        }
    }
}

internal fun JSONObject.only(vararg fields: String) {
    if (keys().asSequence().any { it !in fields }) invalidWire()
}

private fun JSONObject.rows(key: String): List<JSONObject> = getJSONArray(key).let { array ->
    List(array.length()) { array.getJSONObject(it) }
}

private fun JSONObject.matches(role: String, name: String) = rows("items").filter {
    it.getString("role") == role && it.getString("name") == name
}
