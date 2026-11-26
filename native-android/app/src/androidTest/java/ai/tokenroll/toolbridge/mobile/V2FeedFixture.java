package ai.tokenroll.toolbridge.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcel;
import android.os.ResultReceiver;
import android.view.View;
import android.view.ViewTreeObserver;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** A separate test-APK window. The private reply channel changes feed data and measures effects. */
final class V2FeedFixture {
    static final String CHANNEL = "feedFixture";
    static final String TARGET = "收藏 · 城市散步";
    static final String OTHER = "收藏 · 海边日记";
    static final String LEAVE = "返回";
    private final Activity activity;
    private final LinearLayout cards;
    private final TextView ticker;
    private final TextView receipt;
    private final LinearLayout recycledCard;
    private final ScrollView left;
    private final ScrollView right;
    private Button target;
    private int clicks;
    private int otherClicks;
    private int closeClicks;
    private Runnable onNextTick;
    private int generation;
    private int revision;
    private boolean reverse;
    private final Handler ui = new Handler(Looper.getMainLooper());

    // Bundles in the other process can load this framework Parcelable without our anonymous class.
    static ResultReceiver transport(ResultReceiver receiver) {
        Parcel parcel = Parcel.obtain();
        try {
            receiver.writeToParcel(parcel, 0);
            parcel.setDataPosition(0);
            return ResultReceiver.CREATOR.createFromParcel(parcel);
        } finally {
            parcel.recycle();
        }
    }

    static boolean showIfRequested(Activity activity) {
        ResultReceiver hello = activity.getIntent().getParcelableExtra(CHANNEL);
        if (hello == null) return false;
        new V2FeedFixture(activity, hello);
        return true;
    }

    private V2FeedFixture(Activity activity, ResultReceiver hello) {
        this.activity = activity;
        LinearLayout page = column();
        page.setFitsSystemWindows(true);
        page.setFocusableInTouchMode(true);
        page.addView(label("动态     关注的人正在看"));
        LinearLayout panes = new LinearLayout(activity);
        page.addView(panes, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout subscriptions = column();
        left = pane(panes, subscriptions, "关注动态");
        ticker = label("");
        subscriptions.addView(ticker);
        subscriptions.addView(label("关注更新"));
        fill(subscriptions, new String[]{"阿喵相机 · 镜头手记", "小陈放映室 · 本周新片", "车站广播 · 通勤日记"});
        LinearLayout videos = column();
        right = pane(panes, videos, "视频推荐");
        videos.addView(label("为你推荐"));
        receipt = label("已收藏 0");
        videos.addView(receipt);
        cards = column();
        videos.addView(cards);
        rebuild(false);
        recycledCard = column();
        recycledCard.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        recycledCard.setContentDescription("街角早餐 · 阿喵相机");
        Button later = button("稍后再看");
        later.setOnClickListener(v -> otherClicks++);
        recycledCard.addView(later);
        videos.addView(recycledCard);
        Button player = button("播放");
        player.setOnClickListener(v -> player.setText(player.getText().equals("播放") ? "暂停" : "播放"));
        videos.addView(player);
        Button close = button(LEAVE);
        close.setOnClickListener(v -> {
            closeClicks++;
            activity.finish();
        });
        page.addView(close);
        fill(videos, new String[]{"山海纪行 · 城市散步", "海盐同学 · 海边日记", "一帧厨房 · 下班做饭"});

        activity.setContentView(page);
        ui.post(new Runnable() {
            @Override public void run() {
                if (activity.isFinishing() || activity.isDestroyed()) return;
                refreshTicker();
                if (onNextTick != null) {
                    Runnable next = onNextTick;
                    onNextTick = null;
                    next.run();
                }
                ui.postDelayed(this, 220);
            }
        });

        ResultReceiver commands = new ResultReceiver(ui) {
            @Override protected void onReceiveResult(int command, Bundle request) {
                ResultReceiver reply = request.getParcelable(CHANNEL);
                switch (request.getString("op", "")) {
                    case "read":
                        reply.send(0, state());
                        return;
                    case "rebuild":
                        onNextTick = () -> {
                            rebuild(false);
                            afterLayout(() -> reply.send(0, state()));
                        };
                        return;
                    case "twins":
                        rebuild(true);
                        break;
                    case "rebind":
                        // Same "watch later" View, path and action label, now bound to another upload.
                        recycledCard.setContentDescription("山中夜车 · 车站广播");
                        target.setText("收藏 · 新到站的视频");
                        target.setOnClickListener(v -> otherClicks++);
                        break;
                    case "finish":
                        activity.finish();
                        reply.send(0, state());
                        return;
                    default: throw new IllegalArgumentException("Unknown fixture command");
                }
                afterLayout(() -> reply.send(0, state()));
            }
        };
        afterLayout(() -> {
            Bundle info = new Bundle();
            info.putParcelable(CHANNEL, transport(commands));
            hello.send(0, info);
        });
    }

    private void afterLayout(Runnable ready) {
        View root = activity.getWindow().getDecorView();
        root.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override public boolean onPreDraw() {
                root.getViewTreeObserver().removeOnPreDrawListener(this);
                root.post(ready);
                return true;
            }
        });
        root.invalidate();
    }

    private Bundle state() {
        Bundle data = new Bundle();
        data.putInt("closeClicks", closeClicks);
        data.putInt("clicks", clicks);
        data.putInt("otherClicks", otherClicks);
        data.putInt("leftY", left.getScrollY());
        data.putInt("rightY", right.getScrollY());
        data.putInt("generation", generation);
        data.putInt("revision", revision);
        return data;
    }

    private void rebuild(boolean twins) {
        cards.removeAllViews();
        target = button(TARGET);
        target.setOnClickListener(v -> receipt.setText("已收藏 " + ++clicks));
        Button other = button(twins ? TARGET : OTHER);
        other.setOnClickListener(v -> otherClicks++);
        cards.addView(reverse ? other : target);
        cards.addView(reverse ? target : other);
        reverse = !reverse;
        generation++;
    }

    private void refreshTicker() {
        ticker.setText("直播中 · " + ++revision + " 人观看");
    }

    private ScrollView pane(LinearLayout panes, LinearLayout rows, String name) {
        ScrollView scroll = new ScrollView(activity);
        scroll.setContentDescription(name);
        scroll.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        scroll.addView(rows);
        panes.addView(scroll, new LinearLayout.LayoutParams(0, -1, 1));
        return scroll;
    }

    private void fill(LinearLayout list, String[] series) {
        for (int i = 1; i <= 30; i++) {
            String channel = series[(i - 1) % series.length];
            int episode = 1 + (i - 1) / series.length;
            TextView row = label(channel + " 第" + episode + "期\n" + (250 + i * 37) + " 播放");
            row.setMinHeight(Math.round(68 * activity.getResources().getDisplayMetrics().density));
            list.addView(row);
        }
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        return layout;
    }

    private Button button(String name) {
        Button button = new Button(activity);
        button.setText(name);
        return button;
    }

    private TextView label(String value) {
        TextView view = new TextView(activity);
        view.setText(value);
        return view;
    }
}
