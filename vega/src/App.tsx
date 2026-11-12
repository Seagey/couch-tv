// couch-tv on Fire TV (Vega OS): the whole app is Amazon's WebView showing the bridge's home page.
// Written from Amazon's WebView guide (developer.amazon.com/docs/vega/2.0/develop-your-app-with-webview).
// Copy this over src/App.tsx of a project made with `vega project generate`, then see vega/README.md.
import React from 'react';
import { WebView } from '@amazon-devices/webview';
import { View } from 'react-native';
// bridge.json is written by make-config.py (never committed): { "url": "...", "key": "...", "tv": "..." }
import bridge from './bridge.json';

export const App = () => {
  const q = [
    'vega=1',
    'api=' + encodeURIComponent(bridge.url),
    bridge.key ? 'key=' + encodeURIComponent(bridge.key) : '',
    bridge.tv ? 'tv=' + encodeURIComponent(bridge.tv) : '',
  ].filter(Boolean).join('&');
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <WebView
        source={{ uri: bridge.url + '/tv/?' + q }}
        javaScriptEnabled={true}
        hasTVPreferredFocus={true}
        allowSystemKeyEvents={true}
        style={{ flex: 1, backgroundColor: '#000' }}
      />
    </View>
  );
};
