package xyz.numinalabs.app;

import android.content.Intent;
import android.net.Uri;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

/** Launches the hosted workspace using the browser's own authentication context. */
public final class NuminaLauncherActivity extends LauncherActivity {
    private static final Uri HOME = Uri.parse("https://numinalabs.xyz/app");

    @Override
    protected Uri getUrlForIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !"https".equals(uri.getScheme())
                || !"numinalabs.xyz".equals(uri.getHost())
                || uri.getUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
        String path = uri.getPath();
        if (path == null || !(path.equals("/app") || path.startsWith("/app/"))) return null;
        return uri;
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri verified = getUrlForIntent(getIntent());
        return verified == null ? HOME : verified;
    }
}
