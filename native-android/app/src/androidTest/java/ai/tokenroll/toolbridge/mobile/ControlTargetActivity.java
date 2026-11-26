package ai.tokenroll.toolbridge.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Standalone test APK UI. All observable results come from ordinary Android widgets. */
public final class ControlTargetActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (V2FeedFixture.showIfRequested(this)) return;
        LinearLayout page = new LinearLayout(this);
        page.setFitsSystemWindows(true);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setFocusableInTouchMode(true);
        int inset = dp(16);
        page.setPadding(inset, inset, inset, inset);

        TextView title = new TextView(this);
        title.setText("远控测试便签");
        page.addView(title);
        EditText draft = new EditText(this);
        draft.setSingleLine(true);
        draft.setHint("便签正文");
        page.addView(draft);
        TextView saved = new TextView(this);
        saved.setText("尚未保存");
        Button save = new Button(this);
        save.setText("保存便签");
        save.setOnClickListener(v -> saved.setText("已保存：" + draft.getText()));
        page.addView(save);
        page.addView(saved);

        ScrollView history = new ScrollView(this);
        LinearLayout entries = new LinearLayout(this);
        entries.setOrientation(LinearLayout.VERTICAL);
        for (int i = 1; i <= 50; i++) {
            TextView row = new TextView(this);
            row.setMinHeight(dp(64));
            row.setText("历史便签 " + i);
            entries.addView(row);
        }
        history.addView(entries);
        page.addView(history, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(page);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
