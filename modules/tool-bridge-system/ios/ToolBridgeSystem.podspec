Pod::Spec.new do |s|
  s.name           = 'ToolBridgeSystem'
  s.version        = '1.0.0'
  s.summary        = 'High-authority local system boundary for Tool Bridge Mobile'
  s.description    = 'Local shell, clipboard and accessibility probe boundary; user-gated on device.'
  s.author         = 'TokenRollAI'
  s.homepage       = 'https://github.com/TokenRollAI/tool-bridge-mobile'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
