// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Sous-ensemble des types Chainlink VRF v2.5 utilisés par BlockLucky.
/// Reproduit à l'identique les structures de la bibliothèque officielle VRFV2PlusClient,
/// pour que les appels soient compatibles avec le vrai coordinateur.
library VRFV2PlusClient {
    /// Identifiant de format des options d'une requête (bytes4(keccak256("VRF ExtraArgsV1"))).
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment; // vrai : l'oracle est payé en ETH ; faux : en LINK
    }

    struct RandomWordsRequest {
        bytes32 keyHash;              // « voie de gaz » : prix maximum accepté pour la réponse
        uint256 subId;                // abonnement qui paie l'oracle
        uint16 requestConfirmations;  // blocs à attendre avant de répondre
        uint32 callbackGasLimit;      // gaz réservé pour la réponse
        uint32 numWords;              // nombre de nombres aléatoires demandés
        bytes extraArgs;              // options encodées (paiement en ETH ou en LINK)
    }

    function _argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

/// @notice Fonctions du coordinateur Chainlink VRF v2.5 appelées par BlockLucky.
interface IVRFCoordinatorV2Plus {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256 requestId);
    function createSubscription() external returns (uint256 subId);
    function addConsumer(uint256 subId, address consumer) external;
    function fundSubscriptionWithNative(uint256 subId) external payable;
    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers);
}
