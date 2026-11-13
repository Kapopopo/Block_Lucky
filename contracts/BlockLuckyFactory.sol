// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BlockLucky.sol";
import "./IVRFCoordinatorV2Plus.sol";

/// @title BlockLuckyFactory — l'usine à tirages
/// @notice Le propriétaire (l'admin) crée les tirages. L'usine est aussi le client de l'oracle
/// Chainlink VRF : elle transmet les demandes de hasard des tirages et leur renvoie les réponses.
/// Ainsi, un seul contrat est à enregistrer auprès de Chainlink, quel que soit le nombre de tirages.
contract BlockLuckyFactory {
    uint16 public constant REQUEST_CONFIRMATIONS = 3; // minimum Chainlink sur Sepolia
    uint32 public constant CALLBACK_GAS_LIMIT = 200000;

    address public owner;
    IVRFCoordinatorV2Plus public immutable coordinator;
    bytes32 public immutable keyHash;
    bool public immutable nativePayment;
    uint256 public subscriptionId;

    address[] private _lotteries;
    mapping(address => bool) public isLottery;
    mapping(uint256 => address) public lotteryOfRequest;

    event LotteryCreated(address indexed lottery, uint256 indexed round, uint256 deadline, uint256 capacity, uint256 maxTicketsPerPlayer);
    event RandomnessRequested(uint256 indexed requestId, address indexed lottery);
    event RandomnessFulfilled(uint256 indexed requestId, address indexed lottery, uint256 randomWord, bool accepted);
    event OracleFunded(address indexed from, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /// @param coordinator_ Coordinateur VRF (le vrai sur Sepolia, l'imitation en local).
    /// @param keyHash_ « Voie de gaz » choisie chez Chainlink.
    /// @param subscriptionId_ Abonnement existant, ou 0 pour que l'usine crée le sien.
    /// @param nativePayment_ Vrai : l'oracle est payé en ETH. Faux : en LINK.
    constructor(address coordinator_, bytes32 keyHash_, uint256 subscriptionId_, bool nativePayment_) {
        owner = msg.sender;
        coordinator = IVRFCoordinatorV2Plus(coordinator_);
        keyHash = keyHash_;
        nativePayment = nativePayment_;
        if (subscriptionId_ == 0) {
            subscriptionId = coordinator.createSubscription();
            coordinator.addConsumer(subscriptionId, address(this));
        } else {
            subscriptionId = subscriptionId_; // l'usine doit alors être ajoutée comme « consumer » sur vrf.chain.link
        }
    }

    // ---------------------------------------------------------------------
    // Tirages
    // ---------------------------------------------------------------------

    function lotteries() external view returns (address[] memory) {
        return _lotteries;
    }

    function lotteryCount() external view returns (uint256) {
        return _lotteries.length;
    }

    /// Crée un nouveau tirage. Un seul tirage actif à la fois, pour que les joueurs s'y retrouvent.
    function createLottery(uint256 duration, uint256 capacity, uint256 maxTicketsPerPlayer) external onlyOwner returns (address lottery) {
        uint256 count = _lotteries.length;
        require(count == 0 || !BlockLucky(_lotteries[count - 1]).isActive(), "Current draw still active");
        lottery = address(new BlockLucky(address(this), count + 1, duration, capacity, maxTicketsPerPlayer));
        _lotteries.push(lottery);
        isLottery[lottery] = true;
        emit LotteryCreated(lottery, count + 1, block.timestamp + duration, capacity, maxTicketsPerPlayer);
    }

    // ---------------------------------------------------------------------
    // Oracle Chainlink VRF
    // ---------------------------------------------------------------------

    /// Appelée par un tirage quand ses ventes sont closes.
    function requestRandomness() external returns (uint256 requestId) {
        require(isLottery[msg.sender], "Only lotteries");
        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: CALLBACK_GAS_LIMIT,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
            })
        );
        lotteryOfRequest[requestId] = msg.sender;
        emit RandomnessRequested(requestId, msg.sender);
    }

    /// Réponse de l'oracle. Seul le coordinateur peut l'appeler : c'est lui qui a vérifié la preuve.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        require(msg.sender == address(coordinator), "Only coordinator");
        address lottery = lotteryOfRequest[requestId];
        require(lottery != address(0), "Unknown request");
        delete lotteryOfRequest[requestId];
        // Si le tirage a été annulé entre-temps, la réponse est simplement ignorée.
        bool accepted;
        try BlockLucky(lottery).fulfillRandomness(requestId, randomWords[0]) {
            accepted = true;
        } catch {}
        emit RandomnessFulfilled(requestId, lottery, randomWords[0], accepted);
    }

    /// Alimente la réserve de l'oracle en ETH (n'importe qui peut contribuer).
    function fundOracle() external payable {
        require(msg.value > 0, "Nothing sent");
        coordinator.fundSubscriptionWithNative{value: msg.value}(subscriptionId);
        emit OracleFunded(msg.sender, msg.value);
    }

    /// Réserve de l'abonnement : LINK et ETH disponibles pour payer l'oracle.
    function oracleBalance() external view returns (uint96 linkBalance, uint96 nativeBalance) {
        (linkBalance, nativeBalance, , , ) = coordinator.getSubscription(subscriptionId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
