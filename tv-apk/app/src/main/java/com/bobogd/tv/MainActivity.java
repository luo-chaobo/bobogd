package com.bobogd.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebRequestError;

public class MainActivity extends Activity {
    private static final long AUTO_REFRESH_MS = 10 * 60 * 1000L;
    private static final long LOADING_TIMEOUT_MS = 30 * 1000L;

    private GeckoView geckoView;
    private GeckoRuntime geckoRuntime;
    private GeckoSession geckoSession;
    private TextView statusView;
    private boolean loading;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable autoRefresh = new Runnable() {
        @Override
        public void run() {
            loadDashboard();
            handler.postDelayed(this, AUTO_REFRESH_MS);
        }
    };

    private final Runnable loadingTimeout = new Runnable() {
        @Override
        public void run() {
            if (loading) {
                showMessage(
                        "看板加载超时\n"
                                + "地址：https://screen.wljixie.com/tv.html\n"
                                + "请检查电视网络，按遥控器确认键重试"
                );
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUi();
        buildLayout();
        setupGeckoView();
        loadDashboard();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        handler.removeCallbacks(autoRefresh);
        handler.postDelayed(autoRefresh, AUTO_REFRESH_MS);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(autoRefresh);
        handler.removeCallbacks(loadingTimeout);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (geckoSession != null) {
            geckoSession.close();
            geckoSession = null;
        }
        geckoView = null;
        geckoRuntime = null;
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP) {
            int code = event.getKeyCode();
            if (code == KeyEvent.KEYCODE_DPAD_CENTER
                    || code == KeyEvent.KEYCODE_ENTER
                    || code == KeyEvent.KEYCODE_MENU) {
                loadDashboard();
                return true;
            }
            if (code == KeyEvent.KEYCODE_BACK) {
                moveTaskToBack(true);
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 13, 20));

        geckoView = new GeckoView(this);
        root.addView(
                geckoView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                )
        );

        statusView = new TextView(this);
        statusView.setTextColor(Color.rgb(44, 237, 255));
        statusView.setTextSize(24);
        statusView.setGravity(Gravity.CENTER);
        statusView.setBackgroundColor(Color.rgb(5, 13, 20));
        root.addView(
                statusView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                )
        );

        setContentView(root);
    }

    private void setupGeckoView() {
        geckoRuntime = GeckoRuntime.create(this);
        geckoSession = new GeckoSession();
        geckoSession.open(geckoRuntime);
        geckoView.setSession(geckoSession);

        geckoSession.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStart(GeckoSession session, String url) {
                loading = true;
                showMessage("正在加载生产看板...");
            }

            @Override
            public void onPageStop(GeckoSession session, boolean success) {
                loading = false;
                handler.removeCallbacks(loadingTimeout);
                if (!success) {
                    showError("页面加载未成功");
                    return;
                }
                statusView.setVisibility(View.GONE);
                hideSystemUi();
            }
        });

        geckoSession.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override
            public GeckoResult<String> onLoadError(
                    GeckoSession session,
                    String uri,
                    WebRequestError error
            ) {
                loading = false;
                handler.removeCallbacks(loadingTimeout);
                String detail = error == null ? "未知网络错误" : error.toString();
                showError("地址：" + uri + "\n" + detail);
                return null;
            }
        });
    }

    private void loadDashboard() {
        hideSystemUi();
        if (!isNetworkAvailable()) {
            loading = false;
            showMessage("网络未连接\n请检查电视 Wi-Fi 或网线\n按遥控器确认键重试");
            return;
        }

        loading = true;
        showMessage("正在加载生产看板...");
        handler.removeCallbacks(loadingTimeout);
        handler.postDelayed(loadingTimeout, LOADING_TIMEOUT_MS);
        if (geckoSession != null) {
            geckoSession.loadUri(getString(R.string.dashboard_url));
        }
    }

    private void showError(String detail) {
        showMessage(
                "看板加载失败\n"
                        + "请检查网络、服务器或域名证书\n"
                        + detail
                        + "\n按遥控器确认键重试"
        );
    }

    private void showMessage(String text) {
        statusView.setText(text);
        statusView.setVisibility(View.VISIBLE);
    }

    @SuppressWarnings("deprecation")
    private boolean isNetworkAvailable() {
        ConnectivityManager manager =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) {
            return true;
        }
        NetworkInfo info = manager.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }
}
