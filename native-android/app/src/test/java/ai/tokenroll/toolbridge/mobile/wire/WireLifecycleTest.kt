package ai.tokenroll.toolbridge.mobile

import okhttp3.WebSocket
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit.SECONDS
import java.util.concurrent.atomic.AtomicInteger

class WireLifecycleTest {
    @Test fun disabledWhileCredentialReadIsPendingCannotOpenSocket() {
        val reading = CountDownLatch(1)
        val proceed = CountDownLatch(1)
        val states = LinkedBlockingQueue<GatewayState>()
        val sockets = AtomicInteger()
        val device = WireDevice("https://gateway.example", "unit1", {
            reading.countDown()
            check(proceed.await(2, SECONDS))
            WireCredential("https://other.example", "unit1", "key", "test-value")
        }, { error("credential from another origin") }, { error("unexpected execution") })
        GatewayConnection(device, states::add, sockets = WebSocket.Factory { _, _ ->
            sockets.incrementAndGet()
            error("unexpected socket")
        }).use { conn ->
            conn.setEnabled(true)
            assertTrue(reading.await(2, SECONDS))
            conn.setEnabled(false)
            proceed.countDown()
            assertEquals(GatewayState.CONNECTING, states.poll(2, SECONDS))
            assertEquals(GatewayState.SUSPENDED, states.poll(2, SECONDS))
            conn.setEnabled(true)
            assertEquals(GatewayState.CONNECTING, states.poll(2, SECONDS))
            assertEquals(GatewayState.CREDENTIALS_REQUIRED, states.poll(2, SECONDS))
            assertEquals(0, sockets.get())
        }
        assertEquals(GatewayState.CLOSED, states.poll(2, SECONDS))
    }

    @Test fun cancellationIsIdempotentAndRemovable() {
        val signal = WireSignal()
        val events = mutableListOf<String>()
        signal.onCancel { events.add("removed") }.close()
        signal.onCancel { events.add("early") }
        signal.cancel()
        signal.cancel()
        signal.onCancel { events.add("late") }
        assertEquals(listOf("early", "late"), events)
        assertThrows(WireFailure::class.java) { signal.checkActive() }
    }

    @Test fun isoDatesOnApi24KeepOffsetsAndRejectInvalidDates() {
        assertEquals(123L, epoch("1970-01-01T08:00:00.123456+08:00"))
        assertEquals(100L, epoch("1969-12-31T19:00:00.1-05:00"))
        assertThrows(WireFailure::class.java) { epoch("2025-02-30T00:00:00Z") }
    }
}
