pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateContentRecommender is ZamaEthereumConfig {
    struct EncryptedInterestVector {
        euint32 encryptedValue;
        uint256 publicMetadata;
        address owner;
        uint256 timestamp;
        bool isVerified;
    }

    struct Content {
        string contentId;
        euint32 encryptedFeatures;
        uint256 publicCategory;
        address publisher;
        uint256 timestamp;
    }

    mapping(address => EncryptedInterestVector) public userVectors;
    mapping(string => Content) public contentRegistry;
    mapping(address => string[]) public userRecommendations;

    event UserVectorRegistered(address indexed user, uint256 timestamp);
    event ContentPublished(string indexed contentId, address indexed publisher);
    event RecommendationGenerated(address indexed user, string indexed contentId);

    constructor() ZamaEthereumConfig() {}

    function registerUserVector(
        externalEuint32 encryptedVector,
        bytes calldata inputProof,
        uint256 publicMetadata
    ) external {
        require(!userVectors[msg.sender].isVerified, "Vector already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedVector, inputProof)), "Invalid encrypted input");

        userVectors[msg.sender] = EncryptedInterestVector({
            encryptedValue: FHE.fromExternal(encryptedVector, inputProof),
            publicMetadata: publicMetadata,
            owner: msg.sender,
            timestamp: block.timestamp,
            isVerified: true
        });

        FHE.allowThis(userVectors[msg.sender].encryptedValue);
        FHE.makePubliclyDecryptable(userVectors[msg.sender].encryptedValue);

        emit UserVectorRegistered(msg.sender, block.timestamp);
    }

    function publishContent(
        string calldata contentId,
        externalEuint32 encryptedFeatures,
        bytes calldata inputProof,
        uint256 publicCategory
    ) external {
        require(bytes(contentRegistry[contentId].contentId).length == 0, "Content ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedFeatures, inputProof)), "Invalid encrypted input");

        contentRegistry[contentId] = Content({
            contentId: contentId,
            encryptedFeatures: FHE.fromExternal(encryptedFeatures, inputProof),
            publicCategory: publicCategory,
            publisher: msg.sender,
            timestamp: block.timestamp
        });

        FHE.allowThis(contentRegistry[contentId].encryptedFeatures);
        FHE.makePubliclyDecryptable(contentRegistry[contentId].encryptedFeatures);

        emit ContentPublished(contentId, msg.sender);
    }

    function generateRecommendations(
        address user,
        string[] calldata contentIds,
        bytes[] calldata computationProofs
    ) external {
        require(userVectors[user].isVerified, "User vector not verified");
        require(contentIds.length == computationProofs.length, "Input length mismatch");

        for (uint256 i = 0; i < contentIds.length; i++) {
            require(bytes(contentRegistry[contentIds[i]].contentId).length > 0, "Content does not exist");
            require(!isRecommended(user, contentIds[i]), "Content already recommended");

            euint32 similarityScore = computeSimilarity(
                userVectors[user].encryptedValue,
                contentRegistry[contentIds[i]].encryptedFeatures,
                computationProofs[i]
            );

            if (FHE.toUint32(similarityScore) > 75) {
                userRecommendations[user].push(contentIds[i]);
                emit RecommendationGenerated(user, contentIds[i]);
            }
        }
    }

    function computeSimilarity(
        euint32 userVector,
        euint32 contentFeatures,
        bytes calldata computationProof
    ) internal returns (euint32) {
        euint32 similarity = FHE.add(
            FHE.mul(userVector, contentFeatures),
            FHE.constant(0)
        );

        require(FHE.verify(similarity, computationProof), "Computation proof invalid");
        return similarity;
    }

    function isRecommended(address user, string calldata contentId) public view returns (bool) {
        for (uint256 i = 0; i < userRecommendations[user].length; i++) {
            if (keccak256(bytes(userRecommendations[user][i])) == keccak256(bytes(contentId))) {
                return true;
            }
        }
        return false;
    }

    function getUserVector(address user) external view returns (euint32, uint256, bool) {
        return (
            userVectors[user].encryptedValue,
            userVectors[user].publicMetadata,
            userVectors[user].isVerified
        );
    }

    function getContent(string calldata contentId) external view returns (euint32, uint256, address) {
        return (
            contentRegistry[contentId].encryptedFeatures,
            contentRegistry[contentId].publicCategory,
            contentRegistry[contentId].publisher
        );
    }

    function getUserRecommendations(address user) external view returns (string[] memory) {
        return userRecommendations[user];
    }
}

