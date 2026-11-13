// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./IVRFCoordinatorV2Plus.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @title Imitation locale du coordinateur Chainlink VRF v2.5
/// @notice UNIQUEMENT pour Ganache et les tests. Il n'y a pas de nœud Chainlink en local :
/// n'importe qui peut « répondre à la place de l'oracle » (le serveur BlockLucky le fait automatiquement).
/// Sur Sepolia, on utilise le vrai coordinateur, dont la réponse est accompagnée d'une preuve cryptographique.
contract VRFCoordinatorMock is IVRFCoordinatorV2Plus {
    struct Subscription {
        address owner;
        uint96 nativeBalance;
        uint64 reqCount;
        address[] consumers;
    }

    mapping(uint256 => Subscription) private subscriptions;
    mapping(uint256 => address) public consumerOf; // requête en attente → contrat à rappeler
    uint256 public nextSubscriptionId = 1;
    uint256 public nextRequestId = 1;

    event SubscriptionCreated(uint256 indexed subId, address owner);
    event RandomWordsRequested(uint256 indexed requestId, uint256 indexed subId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId, uint256 randomWord);

    function createSubscription() external returns (uint256 subId) {
        subId = nextSubscriptionId++;
        subscriptions[subId].owner = msg.sender;
        emit SubscriptionCreated(subId, msg.sender);
    }

    function addConsumer(uint256 subId, address consumer) external {
        require(subscriptions[subId].owner == msg.sender, "Only subscription owner");
        subscriptions[subId].consumers.push(consumer);
    }

    function fundSubscriptionWithNative(uint256 subId) external payable {
        require(subscriptions[subId].owner != address(0), "Unknown subscription");
        subscriptions[subId].nativeBalance += uint96(msg.value);
    }

    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)
    {
        Subscription storage sub = subscriptions[subId];
        return (0, sub.nativeBalance, sub.reqCount, sub.owner, sub.consumers);
    }

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 requestId) {
        require(_isConsumer(req.subId, msg.sender), "Consumer not registered");
        requestId = nextRequestId++;
        consumerOf[requestId] = msg.sender;
        subscriptions[req.subId].reqCount++;
        emit RandomWordsRequested(requestId, req.subId, msg.sender);
    }

    /// @notice Simule la réponse de l'oracle (local uniquement).
    function fulfillRandomWords(uint256 requestId, uint256 randomWord) external {
        address consumer = consumerOf[requestId];
        require(consumer != address(0), "Unknown or already fulfilled request");
        delete consumerOf[requestId];
        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;
        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
        emit RandomWordsFulfilled(requestId, randomWord);
    }

    function _isConsumer(uint256 subId, address consumer) private view returns (bool) {
        address[] storage consumers = subscriptions[subId].consumers;
        for (uint256 i; i < consumers.length; ++i) if (consumers[i] == consumer) return true;
        return false;
    }
}
