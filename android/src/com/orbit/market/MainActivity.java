package com.orbit.market;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Small online client. Accounts and market data remain on the HTTPS server. */
public class MainActivity extends Activity {
 private WebView web;
 private FrameLayout frame;
 private View customView;
 private WebChromeClient.CustomViewCallback customCallback;
 private static final String HOME="https://myok888.top/";
 private boolean trusted(Uri uri){return "https".equals(uri.getScheme())&&"myok888.top".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(38,60,88));setContentView(frame);
  web=new WebView(this);web.setBackgroundColor(Color.rgb(38,60,88));frame.addView(web,new FrameLayout.LayoutParams(-1,-1));
  // Native container consumes safe insets, so the WebView does not pad them twice.
  if(Build.VERSION.SDK_INT>=30){frame.setOnApplyWindowInsetsListener((v,insets)->{
    android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
    v.setPadding(safe.left,safe.top,safe.right,safe.bottom);
    return new WindowInsets.Builder(insets).setInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime(),android.graphics.Insets.NONE).build();
   });frame.requestApplyInsets();
  }else frame.setFitsSystemWindows(true);
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);settings.setUserAgentString(settings.getUserAgentString()+" OrbitAndroid/1.0.0");
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){Uri uri=request.getUrl();if(trusted(uri))return false;if(request.isForMainFrame()&&("https".equals(uri.getScheme())||"http".equals(uri.getScheme())))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}return true;}
   @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();if(trusted(Uri.parse(url)))view.evaluateJavascript("document.documentElement.classList.add('orbitAndroid');",null);}
   @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showRetry();}
   @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){frame.removeView(view);view.destroy();showRestart();return true;}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onShowCustomView(View view,CustomViewCallback callback){if(customView!=null){callback.onCustomViewHidden();return;}customView=view;customCallback=callback;web.setVisibility(View.GONE);frame.addView(view,new FrameLayout.LayoutParams(-1,-1));}
   @Override public void onHideCustomView(){hideCustom();}
  });
  web.setDownloadListener((url,ua,disposition,mime,length)->{Uri uri=Uri.parse(url);if(trusted(uri))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}});
  if(state==null||web.restoreState(state)==null)web.loadUrl(HOME);
 }
 private void showRetry(){LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(32,64,32,32);panel.setBackgroundColor(Color.rgb(38,60,88));TextView label=new TextView(this);label.setText("暂时无法连接星轨，请检查网络后重试。");label.setTextColor(Color.WHITE);Button retry=new Button(this);retry.setText("重新连接");retry.setOnClickListener(v->{frame.removeView(panel);web.loadUrl(HOME);});panel.addView(label);panel.addView(retry);frame.addView(panel,new FrameLayout.LayoutParams(-1,-1));}
 private void showRestart(){new AlertDialog.Builder(this).setMessage("页面已释放，重新打开即可继续。").setPositiveButton("重新打开",(d,w)->recreate()).setCancelable(false).show();}
 private void hideCustom(){if(customView!=null){frame.removeView(customView);customView=null;web.setVisibility(View.VISIBLE);customCallback.onCustomViewHidden();customCallback=null;}}
 @Override public void onBackPressed(){if(customView!=null){hideCustom();return;}web.evaluateJavascript("(()=>{const h=history.state?.orbitMobilePage;if(h?.depth>0&&window.MarketMobilePages){MarketMobilePages.back();return 'handled'}return 'home'})()",result->{if(!"\"handled\"".equals(result))new AlertDialog.Builder(this).setMessage("退出星轨？").setNegativeButton("取消",null).setPositiveButton("退出",(d,w)->finish()).show();});}
 @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);web.saveState(out);}
 @Override protected void onPause(){super.onPause();web.onPause();CookieManager.getInstance().flush();}
 @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
 @Override protected void onDestroy(){if(web!=null){frame.removeView(web);web.destroy();}super.onDestroy();}
}
