// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BlockLucky.sol";
import "./IVRFCoordinatorV2Plus.sol";

/// @title BlockLuckyFactory — l'usine à tirages
/// @notice Le propriétaire (l'admin) crée les tirages. L'usine est aussi le client de l'oracle
/// Chainlink VRF : elle transmet les demandes de hasard des tirages et leur renvoie les réponses.
/// Ainsi, un seul contrat est à enregistrer auprès de Chainlink, quel que soit le nombre de tirages.
/// Elle est aussi compatible Chainlink Automation : checkUpkeep / performUpkeep clôturent le tirage à l'échéance
/// (et l'annulent si l'oracle reste muet), sans que personne n'ait à cliquer.
contract BlockLuckyFactory {
    uint16 public constant REQUEST_CONFIRMATIONS = 3; // minimum Chainlink sur Sepolia
    uint32 public constant CALLBACK_GAS_LIMIT = 200000;

    /// Actions automatiques possibles sur le tirage en cours (valeur transmise dans performData).
    uint8 public constant ACTION_NONE = 0;
    uint8 public constant ACTION_REQUEST_DRAW = 1;   // échéance passée avec des tickets : demander le hasard
    uint8 public constant ACTION_CANCEL_STALE = 2;   // oracle muet depuis ORACLE_TIMEOUT : annuler (remboursement)

    address public owner;
    /// Tirage modèle, déployé une seule fois : chaque nouveau tirage en est une copie légère (EIP-1167).
    address public immutable implementation;
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
    event UpkeepPerformed(address indexed lottery, uint8 action, address indexed by);

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
        implementation = address(new BlockLucky());
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
        lottery = _clone(implementation);
        BlockLucky(lottery).initialize(address(this), count + 1, duration, capacity, maxTicketsPerPlayer);
        _lotteries.push(lottery);
        isLottery[lottery] = true;
        emit LotteryCreated(lottery, count + 1, block.timestamp + duration, capacity, maxTicketsPerPlayer);
    }

    /// Copie légère du modèle (proxy minimal EIP-1167, 45 octets) : elle délègue tout son code au modèle
    /// mais garde ses propres données. Créer un tirage coûte ainsi environ 30 fois moins de gas.
    function _clone(address target) private returns (address instance) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, target))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "Clone failed");
    }

    // ---------------------------------------------------------------------
    // Clôture automatique (Chainlink Automation, ou n'importe qui)
    // ---------------------------------------------------------------------

    /// Lecture seule, appelée régulièrement par Chainlink Automation : y a-t-il quelque chose à faire ?
    function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory performData) {
        uint8 action = _dueAction();
        return (action != ACTION_NONE, abi.encode(action));
    }

    /// Exécute l'action due. Ouvert à tous : la condition est revérifiée ici, personne ne peut forcer un
    /// tirage avant l'échéance ni annuler un tirage dont l'oracle a répondu à temps.
    function performUpkeep(bytes calldata) external {
        uint8 action = _dueAction();
        require(action != ACTION_NONE, "Nothing to do");
        BlockLucky current = BlockLucky(_lotteries[_lotteries.length - 1]);
        if (action == ACTION_REQUEST_DRAW) current.requestDraw();
        else current.cancel();
        emit UpkeepPerformed(address(current), action, msg.sender);
    }

    function _dueAction() private view returns (uint8) {
        uint256 count = _lotteries.length;
        if (count == 0) return ACTION_NONE;
        BlockLucky current = BlockLucky(_lotteries[count - 1]);
        BlockLucky.Status status = current.status();
        if (status == BlockLucky.Status.Open && block.timestamp >= current.deadline() && current.totalTickets() > 0) {
            return ACTION_REQUEST_DRAW;
        }
        if (status == BlockLucky.Status.Drawing && block.timestamp >= current.drawRequestedAt() + current.ORACLE_TIMEOUT()) {
            return ACTION_CANCEL_STALE;
        }
        return ACTION_NONE;
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
