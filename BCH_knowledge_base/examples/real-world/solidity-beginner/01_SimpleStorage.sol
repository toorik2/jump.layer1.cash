// Source: Solidity Documentation - Introduction to Smart Contracts
// The simplest possible contract - stores and retrieves a single value
// https://gist.github.com/naterush/79b585a5cdd9537fc0af95b75458b87d

pragma solidity ^0.4.8;

contract SimpleStorage {
    uint x;

    function set(uint newValue) {
        x = newValue;
    }

    function get() returns (uint) {
        return x;
    }
}
