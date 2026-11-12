// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BlockLucky — loterie pédagogique (un contrat = un tirage)
/// @notice Prototype de test. Le hash d'un bloc futur peut être biaisé par un validateur :
/// ne jamais utiliser ce mécanisme avec de vrais fonds. En production : un oracle VRF vérifiable.
contract BlockLucky {
    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    /// Prix d'un ticket.
    uint256 public constant TICKET_PRICE = 0.01 ether;
    /// Nombre maximum de tickets par achat.
    uint256 public constant MAX_TICKETS_PER_PURCHASE = 20;
    /// L'EVM ne fournit le hash que des 256 derniers blocs.
    uint256 public constant DRAW_WINDOW = 256;

    /// Date de fin des ventes (timestamp Unix).
    uint256 public immutable deadline;
    /// Nombre maximum de tickets pour ce tirage.
    uint256 public immutable maxTickets;

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    /// Une case par ticket vendu, contenant l'adresse de son propriétaire.
    address[] public tickets;
    /// Nombre de tickets achetés par chaque joueur (sert au remboursement).
    mapping(address => uint256) public ticketCount;
    /// Montant que chaque joueur peut retirer (gain ou remboursement).
    mapping(address => uint256) public credits;
    /// Bloc dont le hash désignera le gagnant (0 = tirage pas encore programmé).
    uint256 public drawBlock;
    /// Vrai une fois le gagnant désigné.
    bool public settled;
    /// Adresse du gagnant.
    address public winner;

    // ---------------------------------------------------------------------
    // Événements (journal public lisible par l'interface)
    // ---------------------------------------------------------------------

    event TicketPurchased(address indexed player, uint256 quantity);
    event DrawScheduled(uint256 blockNumber);
    event WinnerSelected(address indexed player, uint256 prize);
    event Refunded(address indexed player, uint256 amount);
    event Withdrawn(address indexed player, uint256 amount);

    /// @param duration Durée des ventes en secondes.
    /// @param capacity Nombre maximum de tickets (1 à 10 000).
    constructor(uint256 duration, uint256 capacity) {
        require(duration > 0 && capacity > 0 && capacity <= 10000, "Invalid configuration");
        deadline = block.timestamp + duration;
        maxTickets = capacity;
    }

    /// Nombre de tickets vendus.
    function totalTickets() external view returns (uint256) {
        return tickets.length;
    }

    /// Achète `quantity` tickets. Le montant envoyé doit être exact.
    function buyTickets(uint256 quantity) external payable {
        require(block.timestamp < deadline && drawBlock == 0 && !settled, "Sales closed");
        require(
            quantity > 0 &&
                quantity <= MAX_TICKETS_PER_PURCHASE &&
                tickets.length + quantity <= maxTickets,
            "Invalid quantity"
        );
        // Égalité stricte : aucun trop-perçu ne reste bloqué dans le contrat.
        require(msg.value == quantity * TICKET_PRICE, "Wrong payment");

        ticketCount[msg.sender] += quantity;
        for (uint256 i; i < quantity; ++i) {
            tickets.push(msg.sender);
        }
        emit TicketPurchased(msg.sender, quantity);

        // Capacité atteinte : le tirage est programmé tout de suite.
        if (tickets.length == maxTickets) {
            _scheduleDraw();
        }
    }

    /// Après la date limite, n'importe qui peut programmer le tirage.
    function scheduleDraw() external {
        require(
            block.timestamp >= deadline && tickets.length > 0 && drawBlock == 0 && !settled,
            "Not ready"
        );
        _scheduleDraw();
    }

    /// Choisit un bloc futur : son hash est inconnu au moment de la programmation.
    function _scheduleDraw() private {
        drawBlock = block.number + 2;
        emit DrawScheduled(drawBlock);
    }

    /// Désigne le gagnant, entre le bloc programmé et 256 blocs après.
    function draw() external {
        require(
            !settled &&
                drawBlock > 0 &&
                block.number > drawBlock &&
                block.number <= drawBlock + DRAW_WINDOW,
            "Draw unavailable"
        );
        settled = true;

        uint256 random = uint256(keccak256(abi.encode(blockhash(drawBlock), address(this))));
        winner = tickets[random % tickets.length];

        uint256 prize = tickets.length * TICKET_PRICE;
        credits[winner] += prize;
        emit WinnerSelected(winner, prize);
    }

    /// Si personne n'a tiré dans la fenêtre de 256 blocs, chaque joueur récupère sa mise.
    function refund() external {
        require(!settled && drawBlock > 0 && block.number > drawBlock + DRAW_WINDOW, "Refund unavailable");

        uint256 amount = ticketCount[msg.sender] * TICKET_PRICE;
        require(amount > 0, "Nothing to refund");

        ticketCount[msg.sender] = 0; // empêche un double remboursement
        credits[msg.sender] += amount;
        emit Refunded(msg.sender, amount);
    }

    /// Retire ses crédits (« pull payment »).
    /// Le solde est remis à zéro AVANT l'envoi (checks-effects-interactions),
    /// ce qui bloque la réentrance et le double retrait.
    function withdraw() external {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        credits[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
