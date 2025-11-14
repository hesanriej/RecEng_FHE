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
  category: string;
  encryptedScore: string;
  publicViews: number;
  publicLikes: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedScore?: number;
}

interface RecommendationStats {
  matchScore: number;
  relevance: number;
  popularity: number;
  freshness: number;
  diversity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [filteredContents, setFilteredContents] = useState<ContentItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContent, setCreatingContent] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContentData, setNewContentData] = useState({ title: "", category: "AI", score: "", description: "" });
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [statsVisible, setStatsVisible] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    let filtered = contents;
    
    if (searchTerm) {
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (activeCategory !== "all") {
      filtered = filtered.filter(item => item.category === activeCategory);
    }
    
    setFilteredContents(filtered);
  }, [contents, searchTerm, activeCategory]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
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
            category: getCategoryFromValue(businessData.publicValue1),
            encryptedScore: businessId,
            publicViews: Number(businessData.publicValue1) || 0,
            publicLikes: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedScore: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setContents(contentsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const getCategoryFromValue = (value: number): string => {
    const categories = ["AI", "Tech", "Crypto", "Web3", "Security", "Privacy"];
    return categories[value % categories.length] || "General";
  };

  const createContent = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContent(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating content with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const interestScore = parseInt(newContentData.score) || 0;
      const businessId = `content-${Date.now()}`;
      const categoryValue = ["AI", "Tech", "Crypto", "Web3", "Security", "Privacy"].indexOf(newContentData.category);
      
      const encryptedResult = await encrypt(contractAddress, address, interestScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContentData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        categoryValue >= 0 ? categoryValue : 0,
        Math.floor(Math.random() * 1000),
        newContentData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Content created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewContentData({ title: "", category: "AI", score: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingContent(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Interest score decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeRecommendation = (content: ContentItem, decryptedScore: number | null): RecommendationStats => {
    const interestScore = content.isVerified ? (content.decryptedScore || 0) : (decryptedScore || 50);
    const views = content.publicViews || 1;
    const timeFactor = Math.max(0.3, Math.min(1.0, 1 - (Date.now()/1000 - content.timestamp) / (60 * 60 * 24 * 30)));
    
    const matchScore = Math.min(100, Math.round(interestScore * timeFactor));
    const relevance = Math.min(100, Math.round((interestScore * 0.7 + views * 0.3) * 0.8));
    const popularity = Math.min(100, Math.round(Math.log(views + 1) * 20));
    const freshness = Math.round(timeFactor * 100);
    const diversity = Math.min(100, Math.round((100 - Math.abs(interestScore - 50)) * 0.6 + 40));

    return { matchScore, relevance, popularity, freshness, diversity };
  };

  const renderStatsDashboard = () => {
    const totalContents = contents.length;
    const verifiedContents = contents.filter(c => c.isVerified).length;
    const avgViews = contents.length > 0 ? contents.reduce((sum, c) => sum + c.publicViews, 0) / contents.length : 0;
    const recentContents = contents.filter(c => Date.now()/1000 - c.timestamp < 60 * 60 * 24 * 7).length;

    return (
      <div className="stats-dashboard">
        <div className="stat-card neon-purple">
          <h3>Total Contents</h3>
          <div className="stat-value">{totalContents}</div>
          <div className="stat-trend">+{recentContents} this week</div>
        </div>
        
        <div className="stat-card neon-blue">
          <h3>FHE Verified</h3>
          <div className="stat-value">{verifiedContents}/{totalContents}</div>
          <div className="stat-trend">Encrypted & Verified</div>
        </div>
        
        <div className="stat-card neon-pink">
          <h3>Avg Views</h3>
          <div className="stat-value">{avgViews.toFixed(0)}</div>
          <div className="stat-trend">Public Metrics</div>
        </div>
        
        <div className="stat-card neon-green">
          <h3>Categories</h3>
          <div className="stat-value">{new Set(contents.map(c => c.category)).size}</div>
          <div className="stat-trend">Diverse Content</div>
        </div>
      </div>
    );
  };

  const renderRecommendationChart = (content: ContentItem, decryptedScore: number | null) => {
    const analysis = analyzeRecommendation(content, decryptedScore);
    
    return (
      <div className="recommendation-chart">
        <div className="chart-row">
          <div className="chart-label">Match Score</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.matchScore}%` }}>
              <span className="bar-value">{analysis.matchScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Relevance</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.relevance}%` }}>
              <span className="bar-value">{analysis.relevance}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Popularity</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.popularity}%` }}>
              <span className="bar-value">{analysis.popularity}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Freshness</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.freshness}%` }}>
              <span className="bar-value">{analysis.freshness}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Diversity</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${analysis.diversity}%` }}>
              <span className="bar-value">{analysis.diversity}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const categories = ["all", "AI", "Tech", "Crypto", "Web3", "Security", "Privacy"];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Content Recommender 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access privacy-preserving content recommendations powered by FHE.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start encrypted recommendations</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Recommendation System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted content feed...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Content Recommender 🔐</h1>
          <p>FHE-Powered Privacy-First Recommendations</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check System
          </button>
          <button onClick={() => setStatsVisible(!statsVisible)} className="stats-btn">
            {statsVisible ? "Hide Stats" : "Show Stats"}
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Content
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        {statsVisible && (
          <div className="dashboard-section">
            <h2>Recommendation Analytics</h2>
            {renderStatsDashboard()}
          </div>
        )}
        
        <div className="content-section">
          <div className="section-header">
            <h2>Encrypted Content Feed</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search content..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="category-filter">
                {categories.map(cat => (
                  <button
                    key={cat}
                    className={`category-btn ${activeCategory === cat ? 'active' : ''}`}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat === "all" ? "All" : cat}
                  </button>
                ))}
              </div>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="content-grid">
            {filteredContents.length === 0 ? (
              <div className="no-contents">
                <p>No content found matching your criteria</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Add First Content
                </button>
              </div>
            ) : filteredContents.map((content, index) => (
              <div 
                className={`content-card ${content.isVerified ? "verified" : ""}`}
                key={content.id}
                onClick={() => setSelectedContent(content)}
              >
                <div className="card-header">
                  <span className="category-tag">{content.category}</span>
                  <span className="verification-status">
                    {content.isVerified ? "✅ Verified" : "🔓 Encrypted"}
                  </span>
                </div>
                <div className="card-title">{content.title}</div>
                <div className="card-description">{content.description}</div>
                <div className="card-stats">
                  <span>👁️ {content.publicViews} views</span>
                  <span>❤️ {content.publicLikes} likes</span>
                </div>
                <div className="card-footer">
                  <span>{new Date(content.timestamp * 1000).toLocaleDateString()}</span>
                  <span>by {content.creator.substring(0, 6)}...{content.creator.substring(38)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateContent 
          onSubmit={createContent} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingContent} 
          contentData={newContentData} 
          setContentData={setNewContentData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedContent && (
        <ContentDetailModal 
          content={selectedContent} 
          onClose={() => { 
            setSelectedContent(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedContent.id)}
          renderRecommendationChart={renderRecommendationChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateContent: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  contentData: any;
  setContentData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, contentData, setContentData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = value.replace(/[^\d]/g, '');
      setContentData({ ...contentData, [name]: intValue });
    } else {
      setContentData({ ...contentData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-content-modal">
        <div className="modal-header">
          <h2>Add New Content</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Interest score will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Content Title *</label>
            <input 
              type="text" 
              name="title" 
              value={contentData.title} 
              onChange={handleChange} 
              placeholder="Enter content title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={contentData.category} onChange={handleChange}>
              <option value="AI">AI</option>
              <option value="Tech">Tech</option>
              <option value="Crypto">Crypto</option>
              <option value="Web3">Web3</option>
              <option value="Security">Security</option>
              <option value="Privacy">Privacy</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Interest Score (1-100, Integer only) *</label>
            <input 
              type="number" 
              name="score" 
              min="1" 
              max="100" 
              value={contentData.score} 
              onChange={handleChange} 
              placeholder="Enter interest score..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={contentData.description} 
              onChange={handleChange} 
              placeholder="Enter content description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !contentData.title || !contentData.score || !contentData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Content"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ContentDetailModal: React.FC<{
  content: ContentItem;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderRecommendationChart: (content: ContentItem, decryptedScore: number | null) => JSX.Element;
}> = ({ content, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderRecommendationChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="content-detail-modal">
        <div className="modal-header">
          <h2>Content Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="content-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{content.title}</strong>
            </div>
            <div className="info-item">
              <span>Category:</span>
              <strong>{content.category}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{content.creator.substring(0, 6)}...{content.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Published:</span>
              <strong>{new Date(content.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Views:</span>
              <strong>{content.publicViews}</strong>
            </div>
            <div className="info-item">
              <span>Public Likes:</span>
              <strong>{content.publicLikes}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{content.description}</p>
          </div>
          
          <div className="encryption-section">
            <h3>FHE-Protected Interest Score</h3>
            
            <div className="data-row">
              <div className="data-label">Interest Score:</div>
              <div className="data-value">
                {content.isVerified && content.decryptedScore ? 
                  `${content.decryptedScore}/100 (On-chain Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData}/100 (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(content.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Decrypting..." :
                 content.isVerified ? "✅ Verified" :
                 decryptedData !== null ? "🔄 Re-decrypt" : "🔓 Decrypt Score"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Protection</strong>
                <p>Your interest score is encrypted on-chain. Decrypt locally and verify on-chain without exposing raw data.</p>
              </div>
            </div>
          </div>
          
          {(content.isVerified || decryptedData !== null) && (
            <div className="recommendation-section">
              <h3>Personalized Recommendation Analysis</h3>
              {renderRecommendationChart(content, decryptedData)}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Interest Score:</span>
                  <strong>
                    {content.isVerified ? 
                      `${content.decryptedScore}/100 (Verified)` : 
                      `${decryptedData}/100 (Decrypted)`
                    }
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!content.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

