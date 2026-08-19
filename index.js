import './src/polyfills/messageEvent'

// 必须保持最后导入；否则 Expo Router 会先注册并加载 App 模块。
import 'expo-router/entry'
