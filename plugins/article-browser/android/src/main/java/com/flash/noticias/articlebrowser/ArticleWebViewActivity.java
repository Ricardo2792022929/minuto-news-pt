package com.flash.noticias.articlebrowser;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.UserAgentMetadata;
import java.util.Arrays;
import java.util.Collections;

/**
 * Abre o URL original do artigo. A visita conta no site e os anúncios carregam
 * no sítio deles. Não volta a chamar loadUrl dentro de shouldOverrideUrlLoading:
 * isso cancelava a notícia e deixava o ecrã branco com o frame do anúncio.
 */
public class ArticleWebViewActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    private static final String CHROME_MOBILE =
        "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
    /**
     * Corre antes dos scripts da página. Um anúncio que faz document.write
     * depois da página carregada apagava a notícia; o HTML do anúncio passa a
     * ser inserido, sem limpar o artigo.
     */
    private static final String DOCUMENT_START =
        "(function(){try{"
            + "if(!window.chrome){window.chrome={runtime:{},app:{},loadTimes:function(){return{}},csi:function(){return{}}};}"
            + "var write=Document.prototype.write;"
            + "function paint(args,nl){var html=Array.prototype.join.call(args,'');if(nl)html+='\\n';"
            + "if(document.readyState==='loading'){write.call(document,html);return;}"
            + "var box=document.createElement('div');box.innerHTML=html;"
            + "var scripts=box.querySelectorAll('script');"
            + "(document.body||document.documentElement).appendChild(box);"
            + "scripts.forEach(function(old){var s=document.createElement('script');"
            + "for(var i=0;i<old.attributes.length;i++){s.setAttribute(old.attributes[i].name,old.attributes[i].value);}"
            + "s.text=old.text;if(old.parentNode)old.parentNode.replaceChild(s,old);});}"
            + "Document.prototype.write=function(){paint(arguments,false)};"
            + "Document.prototype.writeln=function(){paint(arguments,true)};"
            + "}catch(e){}})();";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_article_web);
        webView = findViewById(R.id.web);
        ProgressBar progress = findViewById(R.id.progress);
        findViewById(R.id.voltar).setOnClickListener(v -> finish());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(CHROME_MOBILE);
        applyChromeClientHints(settings);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, DOCUMENT_START, Collections.singleton("*"));
            } catch (RuntimeException ignored) {
                /* a página abre na mesma */
            }
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                cookies.flush();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri == null ? null : uri.getScheme();
                if (scheme == null || "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    /* sem app para este esquema */
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(view.getContext());
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        view.loadUrl(request.getUrl().toString());
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) webView.goBack();
                else finish();
            }
        });

        loadFromIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadFromIntent(intent);
    }

    private void loadFromIntent(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        if (url != null && !url.isEmpty() && webView != null) {
            webView.loadUrl(url);
        }
    }

    private void applyChromeClientHints(WebSettings settings) {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return;
            UserAgentMetadata metadata = new UserAgentMetadata.Builder()
                .setBrandVersionList(Arrays.asList(
                    new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Chromium").setMajorVersion("141").setFullVersion("141.0.0.0").build(),
                    new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Google Chrome").setMajorVersion("141").setFullVersion("141.0.0.0").build(),
                    new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Not-A.Brand").setMajorVersion("24").setFullVersion("24.0.0.0").build()
                ))
                .setMobile(true)
                .setPlatform("Android")
                .setPlatformVersion("15.0.0")
                .setFullVersion("141.0.0.0")
                .setWow64(false)
                .build();
            WebSettingsCompat.setUserAgentMetadata(settings, metadata);
        } catch (Throwable ignored) {
            /* WebView antiga: fica só o user agent */
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
