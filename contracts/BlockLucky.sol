// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Ce que le tirage a besoin de connaître de l'usine qui l'a créé.
interface IBlockLuckyFactory {
    function owner() external view returns (address);
    function requestRandomness() external returns (uint256 requestId);
}

/// @title BlockLucky — un tirage de la loterie pédagogique
/// @notice Créé par BlockLuckyFactory sous forme de copie légère (« clone » EIP-1167) : le code est déployé
/// une seule fois (le modèle), chaque tirage n'a que ses propres données, ce qui divise le coût de création. Le hasard vient de l'oracle Chainlink VRF :
/// un nombre aléatoire accompagné d'une preuve que personne (ni l'admin, ni un validateur) n'a pu le choisir.
/// Prototype de test, sans audit : ne jamais l'utiliser avec de l'argent réel.
contract BlockLucky {
    // ---------------------------------------------------------------------
    // Règles fixes
    // ---------------------------------------------------------------------

    uint256 public constant TICKET_PRICE = 0.01 ether;
    uint256 public constant MAX_TICKETS_PER_PURCHASE = 20;
    /// Si l'oracle ne répond pas dans ce délai, n'importe qui peut annuler le tirage (remboursement).
    uint256 public constant ORACLE_TIMEOUT = 1 hours;

    /// Ouvert → Tirage demandé à l'oracle → Gagnant désigné, ou Annulé (remboursement).
    enum Status { Open, Drawing, Settled, Cancelled }

    // ---------------------------------------------------------------------
    // Configuration choisie par l'admin à la création
    // ---------------------------------------------------------------------

    // Variables (et non « immutable ») : un clone ne passe pas par le constructeur, il est configuré par initialize().
    IBlockLuckyFactory public factory;
    uint256 public round;               // numéro du tirage (1, 2, 3…)
    uint256 public deadline;            // fin des ventes (timestamp Unix)
    uint256 public maxTickets;          // tickets maximum pour ce tirage
    uint256 public maxTicketsPerPlayer; // limite par adresse, pour l'équité
    bool private initialized;

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    Status public status;
    address[] public tickets;                     // une case par ticket : l'adresse de son propriétaire
    mapping(address => uint256) public ticketCount;
    mapping(address => uint256) public credits;   // gain à retirer
    uint256 public requestId;                     // identifiant de la requête envoyée à l'oracle
    uint256 public drawRequestedAt;
    uint256 public randomWord;                    // nombre aléatoire fourni par l'oracle
    uint256 public winningTicket;                 // numéro du ticket gagnant (à partir de 1)
    address public winner;

    // ---------------------------------------------------------------------
    // Événements (journal public lu par l'interface)
    // ---------------------------------------------------------------------

    event TicketPurchased(address indexed player, uint256 quantity, uint256 firstTicket);
    event DrawRequested(uint256 indexed requestId);
    event WinnerSelected(address indexed player, uint256 prize, uint256 winningTicket, uint256 randomWord);
    event LotteryCancelled(address indexed by);
    event Refunded(address indexed player, uint256 amount);
    event Withdrawn(address indexed player, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == address(factory), "Only factory");
        _;
    }

    /// Le modèle lui-même est verrouillé dès son déploiement : personne ne peut s'en servir comme tirage.
    constructor() {
        initialized = true;
    }

    /// Configuration d'un clone, une seule fois, par l'usine qui vient de le créer (dans la même transaction).
    function initialize(address factory_, uint256 round_, uint256 duration, uint256 capacity, uint256 perPlayer) external {
        require(!initialized, "Already initialized");
        initialized = true;
        require(duration > 0 && capacity > 0 && capacity <= 10000, "Invalid configuration");
        require(perPlayer > 0 && perPlayer <= capacity, "Invalid player limit");
        factory = IBlockLuckyFactory(factory_);
        round = round_;
        deadline = block.timestamp + duration;
        maxTickets = capacity;
        maxTicketsPerPlayer = perPlayer;
    }

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    function totalTickets() external view returns (uint256) {
        return tickets.length;
    }

    /// Un tirage est « actif » tant qu'il peut encore vendre ou attend son résultat.
    /// Un tirage arrivé à échéance sans aucun ticket n'est plus actif.
    function isActive() external view returns (bool) {
        if (status == Status.Drawing) return true;
        if (status != Status.Open) return false;
        return block.timestamp < deadline || tickets.length > 0;
    }

    // ---------------------------------------------------------------------
    // Achat
    // ---------------------------------------------------------------------

    function buyTickets(uint256 quantity) external payable {
        require(status == Status.Open && block.timestamp < deadline, "Sales closed");
        require(
            quantity > 0 && quantity <= MAX_TICKETS_PER_PURCHASE && tickets.length + quantity <= maxTickets,
            "Invalid quantity"
        );
        require(ticketCount[msg.sender] + quantity <= maxTicketsPerPlayer, "Player limit reached");
        // Égalité stricte : aucun trop-perçu ne reste bloqué dans le contrat.
        require(msg.value == quantity * TICKET_PRICE, "Wrong payment");

        uint256 firstTicket = tickets.length + 1;
        ticketCount[msg.sender] += quantity;
        for (uint256 i; i < quantity; ++i) {
            tickets.push(msg.sender);
        }
        emit TicketPurchased(msg.sender, quantity, firstTicket);

        // Capacité atteinte : on demande tout de suite le hasard à l'oracle.
        if (tickets.length == maxTickets) _requestDraw();
    }

    // ---------------------------------------------------------------------
    // Tirage avec Chainlink VRF
    // ---------------------------------------------------------------------

    /// Après la date limite, n'importe qui peut lancer la demande à l'oracle.
    function requestDraw() external {
        require(status == Status.Open && block.timestamp >= deadline && tickets.length > 0, "Not ready");
        _requestDraw();
    }

    function _requestDraw() private {
        status = Status.Drawing; // plus aucun achat possible
        drawRequestedAt = block.timestamp;
        requestId = factory.requestRandomness();
        emit DrawRequested(requestId);
    }

    /// Réponse de l'oracle, transmise par l'usine (seule autorisée).
    function fulfillRandomness(uint256 requestId_, uint256 word) external onlyFactory {
        require(status == Status.Drawing && requestId_ == requestId, "Unexpected randomness");
        status = Status.Settled;
        randomWord = word;
        uint256 index = word % tickets.length; // reste de la division : un numéro entre 0 et N-1
        winningTicket = index + 1;
        winner = tickets[index];
        uint256 prize = tickets.length * TICKET_PRICE;
        credits[winner] += prize;
        emit WinnerSelected(winner, prize, winningTicket, word);
    }

    // ---------------------------------------------------------------------
    // Annulation et remboursement
    // ---------------------------------------------------------------------

    /// L'admin peut annuler avant le résultat. N'importe qui peut annuler si l'oracle
    /// n'a pas répondu dans le délai. Personne ne peut choisir le gagnant.
    function cancel() external {
        require(status == Status.Open || status == Status.Drawing, "Cannot cancel");
        bool isAdmin = msg.sender == factory.owner();
        bool oracleTimedOut = status == Status.Drawing && block.timestamp >= drawRequestedAt + ORACLE_TIMEOUT;
        require(isAdmin || oracleTimedOut, "Not allowed");
        status = Status.Cancelled;
        emit LotteryCancelled(msg.sender);
    }

    /// Remboursement en une seule transaction : la mise revient directement sur le portefeuille du joueur.
    /// Le compteur est remis à zéro AVANT l'envoi (checks-effects-interactions) : pas de double remboursement.
    function refund() external {
        require(status == Status.Cancelled, "Refund unavailable");
        uint256 amount = ticketCount[msg.sender] * TICKET_PRICE;
        require(amount > 0, "Nothing to refund");
        ticketCount[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Refunded(msg.sender, amount);
    }

    /// Retrait du gain (« pull payment ») : le solde est remis à zéro AVANT l'envoi
    /// (checks-effects-interactions), ce qui bloque la réentrance et le double retrait.
    function withdraw() external {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        credits[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
