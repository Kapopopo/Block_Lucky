// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Educational testnet lottery. Future block hashes are validator-biasable.
/// Never deploy this randomness mechanism with real funds; use a verified VRF oracle.
contract BlockLucky {
    uint256 public constant TICKET_PRICE = 0.01 ether;
    uint256 public immutable deadline;
    uint256 public immutable maxTickets;
    address[] public tickets;
    mapping(address => uint256) public ticketCount;
    mapping(address => uint256) public credits;
    uint256 public drawBlock;
    bool public settled;
    address public winner;
    event TicketPurchased(address indexed player, uint256 quantity);
    event DrawScheduled(uint256 blockNumber);
    event WinnerSelected(address indexed player, uint256 prize);
    event Withdrawn(address indexed player, uint256 amount);

    constructor(uint256 duration, uint256 capacity) {
        require(duration > 0 && capacity > 0 && capacity <= 10000, "Invalid configuration");
        deadline = block.timestamp + duration;
        maxTickets = capacity;
    }
    function totalTickets() external view returns (uint256) { return tickets.length; }
    function buyTickets(uint256 quantity) external payable {
        require(block.timestamp < deadline && drawBlock == 0 && !settled, "Sales closed");
        require(quantity > 0 && quantity <= 20 && tickets.length + quantity <= maxTickets, "Invalid quantity");
        require(msg.value == quantity * TICKET_PRICE, "Wrong payment");
        ticketCount[msg.sender] += quantity;
        for (uint256 i; i < quantity; ++i) tickets.push(msg.sender);
        emit TicketPurchased(msg.sender, quantity);
        if (tickets.length == maxTickets) _schedule();
    }
    function scheduleDraw() external {
        require(block.timestamp >= deadline && tickets.length > 0 && drawBlock == 0 && !settled, "Not ready");
        _schedule();
    }
    function _schedule() private { drawBlock = block.number + 2; emit DrawScheduled(drawBlock); }
    function draw() external {
        require(!settled && drawBlock > 0 && block.number > drawBlock && block.number <= drawBlock + 256, "Draw unavailable");
        settled = true;
        winner = tickets[uint256(keccak256(abi.encode(blockhash(drawBlock), address(this)))) % tickets.length];
        uint256 prize = tickets.length * TICKET_PRICE;
        credits[winner] += prize;
        emit WinnerSelected(winner, prize);
    }
    function refund() external {
        require(!settled && drawBlock > 0 && block.number > drawBlock + 256, "Refund unavailable");
        uint256 amount = ticketCount[msg.sender] * TICKET_PRICE;
        require(amount > 0, "Nothing to refund");
        ticketCount[msg.sender] = 0;
        credits[msg.sender] += amount;
    }
    function withdraw() external {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        credits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
