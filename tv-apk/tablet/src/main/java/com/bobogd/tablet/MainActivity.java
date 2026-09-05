package com.bobogd.tablet;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.URLUtil;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSession.NavigationDelegate.LoadRequest;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebResponse;
import org.mozilla.geckoview.WebRequestError;

public class MainActivity extends Activity {
    private static final long LOADING_TIMEOUT_MS = 30 * 1000L;
    private static final int STORAGE_PERMISSION_REQUEST = 41;
    private static final String EXTENSION_LOCATION =
            "resource://android/assets/board-redirect/";
    private static final String EXTENSION_ID = "board-redirect@bobogd.local";

    private GeckoView geckoView;
    private GeckoRuntime geckoRuntime;
    private GeckoSession geckoSession;
    private TextView statusView;
    private boolean canGoBack;
    private boolean loading;
    private Uri currentUri = Uri.EMPTY;
    private DownloadManager downloadManager;
    private PendingDownload pendingDownload;
    private BroadcastReceiver downloadReceiver;
    private final Set<Long> activeDownloads = new HashSet<>();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable loadingTimeout = () -> {
        if (loading) {
            showMessage("页面加载超时\n请检查平板网络\n点击屏幕重试");
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        hideSystemUi();
        buildLayout();
        setupGeckoView();
        setupDownloads();
        startApp();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(loadingTimeout);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (downloadReceiver != null) {
            unregisterReceiver(downloadReceiver);
            downloadReceiver = null;
        }
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
        if (event.getAction() != KeyEvent.ACTION_UP || event.getKeyCode() != KeyEvent.KEYCODE_BACK) {
            return super.dispatchKeyEvent(event);
        }
        if ("/tv.html".equals(currentUri.getPath())) {
            moveTaskToBack(true);
            return true;
        }
        if (canGoBack && geckoSession != null) {
            geckoSession.goBack();
        } else {
            moveTaskToBack(true);
        }
        return true;
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 13, 20));

        geckoView = new GeckoView(this);
        geckoView.setFocusable(true);
        geckoView.setFocusableInTouchMode(true);
        root.addView(geckoView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        statusView = new TextView(this);
        statusView.setTextColor(Color.rgb(64, 214, 189));
        statusView.setTextSize(22);
        statusView.setGravity(Gravity.CENTER);
        statusView.setBackgroundColor(Color.rgb(5, 13, 20));
        statusView.setOnClickListener(view -> startApp());
        root.addView(statusView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
    }

    private void setupGeckoView() {
        geckoRuntime = GeckoRuntime.create(this);
        GeckoSessionSettings sessionSettings = new GeckoSessionSettings.Builder()
                .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                .build();
        geckoSession = new GeckoSession(sessionSettings);
        geckoSession.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override
            public void onExternalResponse(GeckoSession session, WebResponse response) {
                handleExternalResponse(response);
            }
        });
        geckoSession.open(geckoRuntime);
        geckoView.setSession(geckoSession);
        geckoView.requestFocus();

        geckoSession.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStart(GeckoSession session, String url) {
                loading = true;
                currentUri = Uri.parse(url == null ? "" : url);
                showMessage("正在加载波波工单...");
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
            public GeckoResult<AllowOrDeny> onLoadRequest(
                    GeckoSession session,
                    LoadRequest request
            ) {
                if (isAllowedUri(request.uri)) {
                    return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                }
                openExternalBrowser(request.uri);
                return GeckoResult.fromValue(AllowOrDeny.DENY);
            }

            @Override
            public void onCanGoBack(GeckoSession session, boolean value) {
                canGoBack = value;
            }

            @Override
            public GeckoResult<String> onLoadError(
                    GeckoSession session,
                    String uri,
                    WebRequestError error
            ) {
                loading = false;
                handler.removeCallbacks(loadingTimeout);
                String detail = error == null ? "未知网络错误" : error.toString();
                showError(detail);
                return null;
            }
        });
    }

    private void startApp() {
        hideSystemUi();
        showMessage("正在初始化波波工单...");
        geckoRuntime.getWebExtensionController()
                .ensureBuiltIn(EXTENSION_LOCATION, EXTENSION_ID)
                .accept(extension -> loadBackend(), error -> showError("自动进入看板组件初始化失败"));
    }

    private void setupDownloads() {
        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (!activeDownloads.remove(id)) return;
                showDownloadResult(id);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
    }

    private void handleExternalResponse(WebResponse response) {
        closeResponseBody(response);
        if (response == null || !isAllowedDownloadUri(response.uri)) {
            showToast("已拒绝不安全的下载链接");
            return;
        }
        String disposition = header(response.headers, "content-disposition");
        String mimeType = header(response.headers, "content-type");
        String fileName = safeFileName(URLUtil.guessFileName(response.uri, disposition, mimeType));
        PendingDownload download = new PendingDownload(response.uri, fileName, mimeType);
        if (requiresStoragePermission()) {
            pendingDownload = download;
            requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    STORAGE_PERMISSION_REQUEST
            );
            return;
        }
        enqueueDownload(download);
    }

    private boolean isAllowedDownloadUri(String value) {
        Uri uri = Uri.parse(value == null ? "" : value);
        return "https".equalsIgnoreCase(uri.getScheme())
                && getString(R.string.allowed_host).equalsIgnoreCase(uri.getHost())
                && uri.getPath() != null
                && uri.getPath().startsWith("/api/tv-drawings/")
                && uri.getQueryParameter("viewerToken") != null
                && !uri.getQueryParameter("viewerToken").isBlank();
    }

    private boolean requiresStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != STORAGE_PERMISSION_REQUEST || pendingDownload == null) return;
        PendingDownload download = pendingDownload;
        pendingDownload = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            enqueueDownload(download);
        } else {
            showToast("未获得存储权限，无法下载附件");
        }
    }

    private void enqueueDownload(PendingDownload download) {
        if (downloadManager == null) {
            showToast("系统下载服务不可用");
            return;
        }
        try {
            String fileName = uniqueDownloadName(download.fileName);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(download.uri));
            request.setTitle(fileName);
            request.setDescription("波波工单图纸");
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
            );
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            if (download.mimeType != null && !download.mimeType.isBlank()) {
                request.setMimeType(download.mimeType.split(";", 2)[0]);
            }
            long id = downloadManager.enqueue(request);
            activeDownloads.add(id);
            showToast("已开始下载：" + fileName);
        } catch (IllegalArgumentException | SecurityException error) {
            showToast("下载失败：" + error.getMessage());
        }
    }

    private String uniqueDownloadName(String original) {
        File directory = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS
        );
        File candidate = new File(directory, original);
        if (!candidate.exists()) return original;
        int dot = original.lastIndexOf('.');
        String base = dot > 0 ? original.substring(0, dot) : original;
        String extension = dot > 0 ? original.substring(dot) : "";
        for (int index = 1; index < 1000; index += 1) {
            String next = base + " (" + index + ")" + extension;
            if (!new File(directory, next).exists()) return next;
        }
        return base + "-" + System.currentTimeMillis() + extension;
    }

    private String safeFileName(String value) {
        String name = value == null ? "" : value.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (name.isBlank() || ".".equals(name) || "..".equals(name)) {
            return "bobogd-file-" + System.currentTimeMillis();
        }
        return name;
    }

    private String header(Map<String, String> headers, String name) {
        if (headers == null) return "";
        for (Map.Entry<String, String> item : headers.entrySet()) {
            if (name.equalsIgnoreCase(item.getKey())) return item.getValue();
        }
        return "";
    }

    private void closeResponseBody(WebResponse response) {
        if (response == null || response.body == null) return;
        try {
            response.body.close();
        } catch (IOException ignored) {
        }
    }

    private void showDownloadResult(long id) {
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
        try (android.database.Cursor cursor = downloadManager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                showToast("下载状态未知");
                return;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            showToast(status == DownloadManager.STATUS_SUCCESSFUL ? "附件已保存到下载目录" : "附件下载失败");
        }
    }

    private void showToast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private static final class PendingDownload {
        final String uri;
        final String fileName;
        final String mimeType;

        PendingDownload(String uri, String fileName, String mimeType) {
            this.uri = uri;
            this.fileName = fileName;
            this.mimeType = mimeType;
        }
    }

    private boolean isAllowedUri(String value) {
        Uri uri = Uri.parse(value == null ? "" : value);
        String scheme = uri.getScheme();
        if ("https".equalsIgnoreCase(scheme)) {
            return getString(R.string.allowed_host).equalsIgnoreCase(uri.getHost());
        }
        return "about".equalsIgnoreCase(scheme)
                || "blob".equalsIgnoreCase(scheme)
                || "data".equalsIgnoreCase(scheme)
                || "resource".equalsIgnoreCase(scheme);
    }

    private void openExternalBrowser(String value) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value)));
        } catch (ActivityNotFoundException | IllegalArgumentException ignored) {
            showError("无法打开外部链接");
        }
    }

    private void loadBackend() {
        hideSystemUi();
        if (!isNetworkAvailable()) {
            loading = false;
            showMessage("网络未连接\n请检查平板 Wi-Fi\n点击屏幕重试");
            return;
        }

        loading = true;
        showMessage("正在加载波波工单...");
        handler.removeCallbacks(loadingTimeout);
        handler.postDelayed(loadingTimeout, LOADING_TIMEOUT_MS);
        if (geckoSession != null) geckoSession.loadUri(getString(R.string.backend_url));
    }

    private void showError(String detail) {
        showMessage("波波工单加载失败\n" + detail + "\n点击屏幕重试");
    }

    private void showMessage(String text) {
        statusView.setText(text);
        statusView.setVisibility(View.VISIBLE);
    }

    @SuppressWarnings("deprecation")
    private boolean isNetworkAvailable() {
        ConnectivityManager manager =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) return true;
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
