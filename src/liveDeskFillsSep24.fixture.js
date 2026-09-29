// Trimmed real Polymarket US activities (Sep 24 2026 snapshot, newest first):
// the first 14 items. Top-level trades carry no intent / side; ours is on the
// order inside aggressorExecution / passiveExecution. Only the fields the desk
// reads are kept. Item 12 is the POSITION_RESOLUTION for MIL-PHI (item 13).
export const SEP24_ACTIVITIES = [
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVPSQ1VRXCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "5.6500",
      "price": {
        "value": "0.4000"
      },
      "createTime": "2026-09-25T01:04:06.550104033Z",
      "aggressorExecution": {
        "order": {
          "id": "CPMZQQWGWXNY",
          "intent": "ORDER_INTENT_UNDEFINED",
          "outcomeSide": "OUTCOME_SIDE_UNSPECIFIED",
          "action": "ORDER_ACTION_UNSPECIFIED",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVH7BBKJXDN",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVPSJYYTXCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "119.9600",
      "price": {
        "value": "0.4000"
      },
      "createTime": "2026-09-25T01:04:06.237574982Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVJ17P96XDR",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVH7BBKJXDN",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVPSJYS0XCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "24.3900",
      "price": {
        "value": "0.4000"
      },
      "createTime": "2026-09-25T01:04:06.234258844Z",
      "aggressorExecution": {
        "order": {
          "id": "CPMZQQWGCXNY",
          "intent": "ORDER_INTENT_UNDEFINED",
          "outcomeSide": "OUTCOME_SIDE_UNSPECIFIED",
          "action": "ORDER_ACTION_UNSPECIFIED",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVH7BBKJXDN",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVKX4Z7WXCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": true,
      "qtyDecimal": "250.0000",
      "price": {
        "value": "0.3550"
      },
      "createTime": "2026-09-25T00:57:48.619901769Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVF87BR4XDS",
          "intent": "ORDER_INTENT_SELL_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_SELL",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPV7B8FHYXH6",
          "intent": "ORDER_INTENT_UNDEFINED",
          "outcomeSide": "OUTCOME_SIDE_UNSPECIFIED",
          "action": "ORDER_ACTION_UNSPECIFIED",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVK5JRH0XCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "9.3500",
      "price": {
        "value": "0.3350"
      },
      "createTime": "2026-09-25T00:56:11.850646688Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVEP0Z62XDG",
          "intent": "ORDER_INTENT_SELL_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_SELL",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVD1C9FEXDG",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVK5ENPPXCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "8.5600",
      "price": {
        "value": "0.3350"
      },
      "createTime": "2026-09-25T00:56:11.650187701Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVEQHMSCXPM",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVD1C9FEXDG",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVK5EH4RXCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "56.7100",
      "price": {
        "value": "0.3350"
      },
      "createTime": "2026-09-25T00:56:11.478540410Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVEKTFZTXDJ",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVD1C9FEXDG",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVK5EFZWXCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "71.3400",
      "price": {
        "value": "0.3350"
      },
      "createTime": "2026-09-25T00:56:11.430683111Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVENC1D4XDQ",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVD1C9FEXDG",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPVK52KS2XCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "4.4100",
      "price": {
        "value": "0.3350"
      },
      "createTime": "2026-09-25T00:56:10.182861438Z",
      "aggressorExecution": {
        "order": {
          "id": "CPVEP0Y2YXDG",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPVD1C9FEXDG",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPV0TB8J0XCR",
      "marketSlug": "aec-nfl-atl-gb-2026-09-24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "147.0500",
      "price": {
        "value": "0.3200"
      },
      "createTime": "2026-09-25T00:16:06.674677014Z",
      "aggressorExecution": {
        "order": {
          "id": "CPTTM4KS4XPJ",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPTQXZXDTXPM",
          "intent": "ORDER_INTENT_SELL_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_SELL",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CPS9J0SQ6XCR",
      "marketSlug": "asc-nfl-atl-gb-2026-09-24-neg-6pt5",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "2000.0000",
      "price": {
        "value": "0.1700"
      },
      "createTime": "2026-09-24T22:15:33.004116269Z",
      "aggressorExecution": {
        "order": {
          "id": "CPS1D83M6XDN",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CPQS6MVWJXDS",
          "intent": "ORDER_INTENT_BUY_SHORT",
          "outcomeSide": "OUTCOME_SIDE_NO",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CP32KZDN0W1E",
      "marketSlug": "caoc-225bb12249b51d24",
      "state": "TRADE_STATE_NEW",
      "isAggressor": false,
      "qtyDecimal": "44.8500",
      "price": {
        "value": "0.1050"
      },
      "createTime": "2026-09-23T20:22:28.384091093Z",
      "aggressorExecution": {
        "order": {
          "id": "CP2RA60GGWPD",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CP2RCDN4TWP9",
          "intent": "ORDER_INTENT_SELL_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_SELL",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  },
  {
    "type": "ACTIVITY_TYPE_POSITION_RESOLUTION",
    "positionResolution": {
      "marketSlug": "aec-mlb-mil-phi-2026-09-22"
    }
  },
  {
    "type": "ACTIVITY_TYPE_TRADE",
    "trade": {
      "id": "CNEVNBX38W1E",
      "marketSlug": "aec-mlb-mil-phi-2026-09-22",
      "state": "TRADE_STATE_NEW",
      "isAggressor": true,
      "qtyDecimal": "218.7500",
      "price": {
        "value": "0.4400"
      },
      "createTime": "2026-09-22T20:49:21.890462746Z",
      "aggressorExecution": {
        "order": {
          "id": "CNEGBA0A0WPA",
          "intent": "ORDER_INTENT_BUY_LONG",
          "outcomeSide": "OUTCOME_SIDE_YES",
          "action": "ORDER_ACTION_BUY",
          "side": "ORDER_SIDE_BUY"
        }
      },
      "passiveExecution": {
        "order": {
          "id": "CN8H0DE9TWPF",
          "intent": "ORDER_INTENT_UNDEFINED",
          "outcomeSide": "OUTCOME_SIDE_UNSPECIFIED",
          "action": "ORDER_ACTION_UNSPECIFIED",
          "side": "ORDER_SIDE_SELL"
        }
      }
    }
  }
];
