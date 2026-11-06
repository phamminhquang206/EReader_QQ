import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

class StorageBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="empty-library" style={{ minHeight: '100dvh' }}><h1>Chưa thể mở thư viện</h1><p>Trình duyệt không truy cập được dữ liệu cục bộ. Hãy kiểm tra quyền lưu trữ, dung lượng thiết bị hoặc thử mở bằng Safari/Chrome ngoài chế độ riêng tư.</p><button className="button primary" onClick={() => location.reload()}>Thử lại</button></main> : this.props.children
  }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><StorageBoundary><App /></StorageBoundary></React.StrictMode>)
