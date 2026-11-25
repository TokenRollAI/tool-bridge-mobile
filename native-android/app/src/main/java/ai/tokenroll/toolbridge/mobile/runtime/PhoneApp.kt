package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper

class PhoneApp : Application(), Application.ActivityLifecycleCallbacks {
    lateinit var runtime: PhoneRuntime
        private set
    private val main = Handler(Looper.getMainLooper())
    private var visible = 0
    private val lostVisibility = Runnable { if (visible == 0) runtime.setForeground(false) }
    override fun onCreate() {
        super.onCreate()
        runtime = PhoneRuntime(this)
        registerActivityLifecycleCallbacks(this)
        runtime.initialize()
    }
    override fun onActivityStarted(a: Activity) { visible++; main.removeCallbacks(lostVisibility); runtime.setForeground(true) }
    override fun onActivityStopped(a: Activity) { visible--; if (visible == 0) main.post(lostVisibility) }
    override fun onActivityResumed(a: Activity) { runtime.activity = a }
    override fun onActivityPaused(a: Activity) { if (runtime.activity === a) runtime.activity = null }
    override fun onActivityCreated(a: Activity, s: Bundle?) {}
    override fun onActivityDestroyed(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, s: Bundle) {}
}
