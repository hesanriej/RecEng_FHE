import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ContentItem {
  id: string;
  title: string;
  description: string;
  encryptedScore: number;
  publicViews: number;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedScore?: number;
  category: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContent, setCreatingContent] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContentData, setNewContentData] = useState({ 
    title: "", 
    description: "", 
    score: "", 
    views: "",
    category: "AI"
  });
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [stats, setStats] = useState({
    total: 0,
    verified: 0,
    avgScore: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        const businessIds = await contract.getAllBusinessIds();
        const contentsList: ContentItem[] = [];
        
        for (const businessId of businessIds) {
          try {
            const businessData = await contract.getBusinessData(businessId);
            contentsList.push({
              id: businessId,
              title: businessData.name,
              description: businessData.description,
              encryptedScore: 0,
              publicViews: Number(businessData.publicValue1) || 0,
              creator: businessData.creator,
              timestamp: Number(businessData.timestamp),
              isVerified: businessData.isVerified,
              decryptedScore: Number(businessData.decryptedValue) || 0,
              category: "AI"
            });
          } catch (e) {
            console.error('Error loading content:', e);
          }
        }
        
        setContents(contentsList);
        
        const verifiedCount = contentsList.filter(c => c.isVerified).length;
        setStats({
          total: contentsList.length,
          verified: verifiedCount,
          avgScore: contentsList.length > 0 ? 
            contentsList.reduce((sum, c) => sum + (c.decryptedScore || 0), 0) / contentsList.length : 0
        });
      } catch (e) {
        console.error('Load data error:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const createContent = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContent(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE加密创建内容..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const scoreValue = parseInt(newContentData.score) || 0;
      const businessId = `content-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContentData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newContentData.views) || 0,
        0,
        newContentData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "内容创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      window.location.reload();
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingContent(false); 
    }
  };

  const decryptScore = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      return Number(clearValue);
      
    } catch (e: any) { 
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const handleCheckAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "系统可用性检查通过!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredContents = contents.filter(content => {
    const matchesSearch = content.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         content.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || content.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>隐私推荐引擎 🔐</h1>
            <span>FHE加密兴趣匹配</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🔒</div>
            <h2>连接钱包开始使用</h2>
            <p>您的兴趣向量将全程加密，系统通过同态计算匹配内容，不收集个人画像</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>隐私推荐引擎</h1>
          <span>FHE保护的兴趣匹配</span>
        </div>
        
        <div className="header-controls">
          <button className="action-btn" onClick={handleCheckAvailable}>
            检查系统
          </button>
          <button 
            className="create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            + 添加内容
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="stats-panel">
        <div className="stat-item">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">总内容</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.verified}</div>
          <div className="stat-label">已验证</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.avgScore.toFixed(1)}</div>
          <div className="stat-label">平均分</div>
        </div>
      </div>

      <div className="search-section">
        <div className="search-bar">
          <input 
            type="text"
            placeholder="搜索内容..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select 
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="all">全部分类</option>
          <option value="AI">AI</option>
          <option value="Tech">技术</option>
          <option value="Crypto">加密</option>
        </select>
      </div>

      <div className="content-grid">
        {filteredContents.map((content) => (
          <div 
            key={content.id}
            className="content-card"
            onClick={() => setSelectedContent(content)}
          >
            <div className="card-header">
              <h3>{content.title}</h3>
              <span className={`status ${content.isVerified ? 'verified' : 'encrypted'}`}>
                {content.isVerified ? '✅' : '🔒'}
              </span>
            </div>
            <p>{content.description}</p>
            <div className="card-meta">
              <span>浏览: {content.publicViews}</span>
              <span>评分: {content.isVerified ? content.decryptedScore : '加密中'}</span>
            </div>
          </div>
        ))}
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>添加推荐内容</h2>
              <button onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                placeholder="标题"
                value={newContentData.title}
                onChange={(e) => setNewContentData({...newContentData, title: e.target.value})}
              />
              <textarea
                placeholder="描述"
                value={newContentData.description}
                onChange={(e) => setNewContentData({...newContentData, description: e.target.value})}
              />
              <input
                type="number"
                placeholder="兴趣评分 (FHE加密)"
                value={newContentData.score}
                onChange={(e) => setNewContentData({...newContentData, score: e.target.value})}
              />
              <input
                type="number"
                placeholder="浏览数"
                value={newContentData.views}
                onChange={(e) => setNewContentData({...newContentData, views: e.target.value})}
              />
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>取消</button>
              <button 
                onClick={createContent}
                disabled={creatingContent || isEncrypting}
              >
                {creatingContent ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedContent && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedContent.title}</h2>
              <button onClick={() => setSelectedContent(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>{selectedContent.description}</p>
              <div className="detail-info">
                <div>创建者: {selectedContent.creator}</div>
                <div>浏览数: {selectedContent.publicViews}</div>
                <div>评分: {selectedContent.isVerified ? selectedContent.decryptedScore : '加密中'}</div>
              </div>
              <button 
                onClick={() => decryptScore(selectedContent.id)}
                disabled={fheIsDecrypting}
              >
                {fheIsDecrypting ? '解密中...' : '解密评分'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

export default App;