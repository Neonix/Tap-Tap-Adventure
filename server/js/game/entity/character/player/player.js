/* global require, module, log, databaseHandler */

var _ = require("underscore"),
    Character = require('./../character'),
    Messages = require("./../../../network/packets/message"),
    Utils = require("./../../../utils/utils"),
    MobData = require("./../../../utils/data/mobdata"),
    Bank = require("./bank/bank"),
    Types = require("../../../../../../shared/js/gametypes"),
    ItemTypes = require("../../../../../../shared/js/itemtypes"),
    bcrypt = require('bcrypt'),
    Inventory = require("./inventory/inventory"),
    SkillHandler = require("./../../../handlers/skillhandler"),
    express = require('express'),
    Achievements = require('./../../../utils/data/achievementdata'),
    request = require("request"),
    PacketHandler = require("./../../../handlers/packethandler"),
    QuestHandler = require('../../../handlers/questhandler'),
    Timer = require('../../../utils/timer');

module.exports = Player = Character.extend({
    init: function (connection, worldServer, databaseHandler) {
        var self = this;

        self.server = worldServer;
        self.connection = connection;
        self.redisPool = databaseHandler;

        self._super(this.connection.id, "player", 1, 0, 0, "");

        self.hasEnteredGame = false;
        self.isDead = false;
        self.haters = {};
        self.lastCheckpoint = null;
        self.friends = {};
        self.ignores = {};
        self.pets = [];
        self.inventory = null;
        self.pvpFlag = false;
        self.gameFlag = false;
        self.bannedTime = 0;
        self.banUseTime = 0;
        self.membershipTime = 0;
        self.experience = 0;
        self.level = 0;
        self.lastWorldChatMinutes = 99;
        self.achievement = [];
        self.royalAzaleaBenefTimeout = null;
        self.cooltimeTimeout = null;
        self.consumeTimeout = null;
        self.rights = 0;
        self.skillHandler = new SkillHandler();
        self.inPVPLobby = false;
        self.inPVPGame = false;
        self.kothLobby = false;
        self.kothGame = false;
        self.healExecuted = 0;
        self.flareDanceCallback = null;
        self.flareDanceExecuted1 = 0;
        self.flareDanceExecuted2 = 0;
        self.flareDanceCount = 0;
        self.activeSkill = 0;
        self.stunExecuted = 0;
        self.quests = [];
        self.superCatCallback = null;
        self.superCatExecuted = 0;
        self.poisoned = false;
        self.provocationExecuted = 0;
        self.pubPointBuyTimeout = null;
        self.membership = false;
        self.chatBanEndTime = 0;
        self.isPlayer = true;
        self.hasFocus = true;
        self.attackedTime = new Timer(950);
        self.pClass = 0;
        self.minigameTeam = -1;
        self.talkingAllowed = true;
        self.new = false;
        self.ready = false;
        
        self.packetHandler = new PacketHandler(self, connection, worldServer, databaseHandler);
    },

    postLoad: function() {
        var self = this;

        self.ready = true;

        setTimeout(function() {

            self.questHandler = new QuestHandler(self);

        }, self.new ? 1000 : 100)
    },

    destroy: function () {
        var self = this;

        self.forEachAttacker(function (mob) {
            mob.clearTarget();
        });

        self.attackers = {};

        self.forEachHater(function (mob) {
            mob.forgetPlayer(self.id);
        });
        this.haters = {};
    },

    getState: function () {
        var basestate = this._getBaseState(),
            state = [this.name, this.orientation, this.armor, this.weapon, this.level];

        if (this.target) {
            state.push(this.target.id);
        }

        return basestate.concat(state);
    },

    send: function (message) {
        this.connection.send(message);
    },

    verifyPositioning: function () {

    },

    flagPVP: function (pvpFlag) {
        if (this.pvpFlag !== pvpFlag) {
            this.pvpFlag = pvpFlag;
            this.server.pushToPlayer(this, new Messages.PVP(this.pvpFlag));
            this.server.pushToPlayer(this, new Messages.Chat(this, this.pvpFlag ? "You are now in a PVP zone!" : "You are no longer in a PVP zone!"));
        }
    },

    checkGameFlag: function (gameFlag) {
        if (this.gameFlag !== gameFlag) {
            this.gameFlag = gameFlag;
            this.server.pushToPlayer(this, new Messages.GameFlag(this.gameFlag));
            this.server.pushToPlayer(this, new Messages.Chat(this, this.gameFlag ? "You have entered the lobby!" : "You are no longer in lobby."));

            if (this.gameFlag)
                this.server.getMinigameHandler().getPVPMinigame().addPlayer(this);
            else
                this.server.getMinigameHandler().getPVPMinigame().removePlayer(this);
        }
    },

    equip: function (item) {
        return new Messages.EquipItem(this, item);
    },

    addHater: function (mob) {
        if (mob) {
            if (!(mob.id in this.haters)) {
                this.haters[mob.id] = mob;
            }
        }
    },

    removeHater: function (mob) {
        if (mob && mob.id in this.haters) {
            delete this.haters[mob.id];
        }
    },

    forEachHater: function (callback) {
        _.each(this.haters, function (mob) {
            callback(mob);
        });
    },

    equipArmor: function (kind, enchantedPoint, skillKind, skillLevel) {
        this.armor = kind;
        this.armorEnchantedPoint = enchantedPoint;
        this.armorLevel = ItemTypes.getArmorLevel(kind) + enchantedPoint;
        this.armorSkillKind = skillKind;
        this.armorSkillLevel = skillLevel;
    },
    equipWeapon: function (kind, enchantedPoint, skillKind, skillLevel) {
        this.weapon = kind;
        this.weaponEnchantedPoint = enchantedPoint;
        this.weaponLevel = ItemTypes.getWeaponLevel(kind) + enchantedPoint;
        this.weaponSkillKind = skillKind;
        this.weaponSkillLevel = skillLevel;
    },

    equipPendant: function (kind, enchantedPoint, skillKind, skillLevel) {
        this.pendant = kind;
        this.pendantEnchantedPoint = enchantedPoint;
        this.pendantLevel = ItemTypes.getPendantLevel(kind) + enchantedPoint;
        this.pendantSkillKind = skillKind;
        this.pendantSkillLevel = skillLevel;
    },

    equipRing: function (kind, enchantedPoint, skillKind, skillLevel) {
        this.ring = kind;
        this.ringEnchantedPoint = enchantedPoint;
        this.ringLevel = ItemTypes.getRingLevel(kind) + enchantedPoint;
        this.ringSkillKind = skillKind;
        this.ringSkillLevel = skillLevel;
    },

    equipBoots: function (kind, enchantedPoint, skillKind, skillLevel) {
        this.boots = boots;
        this.bootsEnchantedPoint = enchantedPoint;
        this.bootsLevel = ItemTypes.getBootsLevel(kind) + enchantedPoint;
        this.bootsSkillKind = skillKind;
        this.bootsSkillLevel = skillLevel;
    },

    equipItem: function (itemKind, enchantedPoint, skillKind, skillLevel, isAvatar) {
        if (itemKind) {
            if (ItemTypes.isArmor(itemKind) || ItemTypes.isArcherArmor(itemKind)) {
                databaseHandler.equipArmor(this.name, ItemTypes.getKindAsString(itemKind), enchantedPoint, skillKind, skillLevel);
                this.equipArmor(itemKind, enchantedPoint, skillKind, skillLevel);
            } else if (ItemTypes.isWeapon(itemKind) || ItemTypes.isArcherWeapon(itemKind)) {
                databaseHandler.equipWeapon(this.name, ItemTypes.getKindAsString(itemKind), enchantedPoint, skillKind, skillLevel);
                this.equipWeapon(itemKind, enchantedPoint, skillKind, skillLevel);
            } else if (ItemTypes.isPendant(itemKind)) {
                databaseHandler.equipPendant(this.name, ItemTypes.getKindAsString(itemKind), enchantedPoint, skillKind, skillLevel);
                this.equipPendant(itemKind, enchantedPoint, skillKind, skillLevel);
            } else if (ItemTypes.isRing(itemKind)) {
                databaseHandler.equipRing(this.name, ItemTypes.getKindAsString(itemKind), enchantedPoint, skillKind, skillLevel);
                this.equipRing(itemKind, enchantedPoint, skillKind, skillLevel);
            }
        }
    },
    unequipItem: function (kind) {
        var self = this;

        if (!kind)
            return;

        if (ItemTypes.isEitherWeapon(kind)) {
            databaseHandler.equipWeapon(self.name, '', 0, 0, 0);
            self.equipWeapon(0, 0, 0, 0);
        } else if (ItemTypes.isEitherWeapon(kind)) {
            databaseHandler.equipArmor(self.name, '', 0, 0, 0);
            self.equipArmor(0, 0, 0, 0);
        } else if (ItemTypes.isPendant(kind)) {
            databaseHandler.equipPendant(self.name, '', 0, 0, 0);
            self.equipPendant(0, 0, 0, 0);
        } else if (ItemTypes.isRing(kind)) {
            databaseHandler.equipRing(self.name, '', 0, 0, 0);
            self.equipRing(0, 0, 0, 0);
        }
    },

    updateHitPoints: function () {
        this.resetHitPoints(this.getHp());
        this.resetMana(this.getMp());
    },

    updatePosition: function () {
        if (this.requestpos_callback) {
            var pos = this.requestpos_callback();
            this.setPosition(pos.x, pos.y);
        }
    },

    getSpawnPoint: function () {
        var self = this,
            playerTeam = self.getTeam(),
            offset = Utils.randomInt(-2, 2);

        if (playerTeam == Types.Messages.REDTEAM)
            return [163 + offset, 499 + offset];
        else if (playerTeam == Types.Messages.BLUETEAM)
            return [133 + offset, 471 + offset];
        else
            return [325 + offset, 87 + offset];
    },

    onRequestPosition: function (callback) {
        this.requestpos_callback = callback;
    },

    achievementAboutKill: function (mob) {
        var self = this;

        for (var i = 0; i < Object.keys(Achievements.AchievementData).length; i++) {
            var achievement = Achievements.AchievementData[i];
            if (achievement.type == 2) {
                this.tmpAchievement = achievement;
                this._achievementAboutKill(mob.kind, achievement, function (achievement) {
                    if (self.tmpAchievement.xp) {
                        self.incExp(self.tmpAchievement.xp);
                        //self.server.pushToPlayer(self, new Messages.Kill(mob, self.level, self.experience));
                    }


                    var skillName = self.tmpAchievement.skillName;
                    var skillLevel = self.tmpAchievement.skillLevel;
                    if (skillName && skillLevel) {
                        self.skillHandler.add(skillName, skillLevel);
                        var index = self.skillHandler.getIndexByName(skillName);
                        databaseHandler.handleSkills(self, index, skillName, skillLevel);
                        self.server.pushToPlayer(self, new Messages.SkillLoad(index, skillName, skillLevel));
                    }
                });
            }
        }
    },

    achievementAboutItem: function (npcKind, achievementNumber, itemKind, itemCount, callback) {
        /*var achievementData = Achievements.AchievementData[achievementNumber],
            achievement = this.achievement[achievementNumber];

        if (achievement.found && achievement.progress !== 999) {
            if (this.inventory.hasItems(itemKind, itemCount)) {
                this.inventory.takeOut(itemKind, itemCount);
                this.send([Types.Messages.ACHIEVEMENT, "complete", achievementNumber]);
                achievement.progress = 999;

                if (callback) callback();

                databaseHandler.progressAchievement(this.name, achievementNumber, 999);
                this.incExp(achievementData.xp);
                //self.server.pushToPlayer(this, new Messages.Kill("null", self.level, self.experience));
                this.server.pushToPlayer(this, new Messages.TalkToNPC(npcKind, achievementNumber, true));
            } else
                this.server.pushToPlayer(this, new Messages.TalkToNPC(npcKind, achievementNumber, false));
        }*/

    },

    _achievementAboutKill: function (mobKind, achievement, callback) {
        if (achievement.mobId.length > 1 && (achievement.mobId.indexOf(mobKind) > -1) ||
            (mobKind === achievement.mobId) ||
            (achievement.mobId == 0 && MobData.Kinds[mobKind].level * 2 > this.level)) {
            if (achievement.requirement === 1 && this.weapon)
                return;

            var achievementId = achievement.id;
            var mobCount = achievement.mobCount;
            var achievement = this.achievement[achievement.id];

            if (achievement.found && achievement.progress !== 999) {
                if (isNaN(achievement.progress))
                    achievement.progress = 1;
                else
                    achievement.progress++;

                if (achievement.progress >= mobCount) {
                    this.send([Types.Messages.ACHIEVEMENT, "complete", achievementId]);
                    achievement.progress = 999;
                    if (callback)
                        callback();
                }

                databaseHandler.progressAchievement(this.name, achievementId, achievement.progress);
                if (achievement.progress < mobCount) {
                    this.send([Types.Messages.ACHIEVEMENT, "progress", achievementId, achievement.progress]);
                }
            }
        }
    },

    foundAchievement: function (achievementId) {
        var self = this;

        self.achievement[achievementId] = {};
        self.achievement[achievementId].found = true;
        self.redisPool.foundAchievement(self.name, achievementId);
        self.server.pushToPlayer(self, new Messages.Achievement('found', achievementId));
    },

    incExp: function (gotexp, mob) {
        var self = this,
            receivedExp = gotexp;

        if (mob) {
            var mobLevel = MobData.Kinds[mob.kind].level;
            if (mobLevel > self.level) {
                var multiplier = Utils.randomRange(1.2, 1.2 + (mobLevel - self.level) / 7);
                receivedExp *= multiplier;
            }
        }

        if (isNaN(receivedExp) || receivedExp < 0)
            receivedExp = 1;

        self.experience += parseInt(Math.round(receivedExp));

        var previousLevel = self.level;
        self.level = Types.getLevel(self.experience);

        if (previousLevel != self.level)
            self.updateHitPoints();

        self.server.pushToPlayer(self, new Messages.PlayerPoints(self.maxHitPoints, self.maxMana, self.hitPoints, self.mana));

        self.redisPool.setExp(self.name, self.experience);

        return parseInt(Math.round(receivedExp));
    },

    checkName: function (name) {
        if (name === null) return false;
        else if (name === '') return false;
        else if (name === ' ') return false;

        for (var i = 0; i < name.length; i++) {
            var c = name.charCodeAt(i);

            if (!((0xAC00 <= c && c <= 0xD7A3) || (0x3131 <= c && c <= 0x318E)       // Korean (Unicode blocks "Hangul Syllables" and "Hangul Compatibility Jamo")
                || (0x61 <= c && c <= 0x7A) || (0x41 <= c && c <= 0x5A)             // English (lowercase and uppercase)
                || (0x30 <= c && c <= 0x39)                                         // Numbers
                || (c === 0x20) || (c === 0x5f)                                       // Space and underscore
                || (c === 0x28) || (c === 0x29)                                       // Parentheses
                || (c === 0x5e))) {                                                  // Caret
                return false;
            }
        }
        return true;
    },

    movePlayer: function (x, y) {
        var self = this,
            message = [Types.Messages.TELEPORT, self.id, x, y];

        self.send(message);
    },

    setMaxes: function () {
        this.setMaxHitPoints(40);
        this.setMaxMana(10);
    },

    sendWelcome: function (armor, weapon, exp,
                           bannedTime, banUseTime, x, y, chatBanEndTime, rank,
                           armorEnchantedPoint, armorSkillKind, armorSkillLevel,
                           weaponEnchantedPoint, weaponSkillKind, weaponSkillLevel,
                           pendant, pendantEnchantedPoint, pendantSkillKind, pendantSkillLevel,
                           ring, ringEnchantedPoint, ringSkillKind, ringSkillLevel,
                           boots, bootsEnchantedPoint, bootsSkillKind, bootsSkillLevel,
                           membership, membershipTime, kind, rights, pClass, poisoned, hitpoints,
                           mana, ttacoins, pvpKills, pvpDeaths) {

        var self = this;
        self.kind = kind;
        self.rights = rights;
        self.equipArmor(ItemTypes.getKindFromString(armor), armorEnchantedPoint, armorSkillKind, armorSkillLevel);
        self.equipWeapon(ItemTypes.getKindFromString(weapon), weaponEnchantedPoint, weaponSkillKind, weaponSkillLevel);
        self.equipPendant(ItemTypes.getKindFromString(pendant), pendantEnchantedPoint, pendantSkillKind, pendantSkillLevel);
        self.equipRing(ItemTypes.getKindFromString(ring), ringEnchantedPoint, ringSkillKind, ringSkillLevel);
        //self.equipBoots(ItemTypes.getKindFromString(boots), bootsEnchantedPoint, bootsSkillKind, bootsSkillLevel)
        self.membership = membership;
        self.bannedTime = bannedTime;
        self.banUseTime = banUseTime;
        self.membershipTime = membershipTime;
        self.chatBanEndTime = chatBanEndTime;
        self.experience = parseInt(Math.floor(exp));
        self.level = Types.getLevel(self.experience);
        self.poisoned = poisoned;
        self.orientation = Utils.randomOrientation;
        self.pClass = pClass;
        self.TTACoins = ttacoins;
        self.pvpKills = pvpKills;
        self.pvpDeaths = pvpDeaths;
        self.updateHitPoints();
        self.setHitPoints(hitpoints);
        self.setMana(mana);

        if (x === 0 && y === 0)
            self.updatePosition();
        else
            self.setPosition(x, y);

        self.server.addPlayer(self);
        self.server.enter_callback(self);

        databaseHandler.getBankItems(self, function (maxBankNumber, bankKinds, bankNumbers, bankSkillKinds, bankSkillLevels) {
            self.bank = new Bank(self, maxBankNumber, bankKinds, bankNumbers, bankSkillKinds, bankSkillLevels);

            databaseHandler.getAllInventory(self, function (maxInventoryNumber, itemKinds, itemNumbers, itemSkillKinds, itemSkillLevels) {
                self.inventory = new Inventory(self, maxInventoryNumber, itemKinds, itemNumbers, itemSkillKinds, itemSkillLevels);
                
                
                databaseHandler.loadAchievement(self, function () {
                    var i = 0;
                    var sendMessage = [
                        Types.Messages.WELCOME,
                        self.id, // 1
                        self.name, //2
                        self.x, //3
                        self.y, //4
                        self.maxHitPoints ? self.maxHitPoints : 40, //5
                        self.armor, //6
                        self.weapon, //7
                        self.experience, //10
                        self.maxMana ? self.maxMana : 10, //11
                        self.server.doubleEXP, //12
                        self.server.expMultiplier, //13
                        self.membership, //14
                        self.kind, //15
                        self.rights, //16
                        self.pClass,
                        self.pendant,
                        self.ring,
                        self.boots
                    ];

                    sendMessage.push(self.inventory.size);

                    for (i = 0; i < self.inventory.size; i++) {
                        var item = self.inventory.slots[i];

                        sendMessage.push(item.kind);
                        sendMessage.push(item.count);
                        sendMessage.push(item.skillKind);
                        sendMessage.push(item.skillLevel);
                    }

                    sendMessage.push(self.bank.number);
                    for (i = 0; i < self.bank.number; i++) {
                        sendMessage.push(self.bank.rooms[i].itemKind);
                        sendMessage.push(self.bank.rooms[i].itemNumber);
                        sendMessage.push(self.bank.rooms[i].itemSkillKind);
                        sendMessage.push(self.bank.rooms[i].itemSkillLevel);
                    }

                    var achievementLength = Object.keys(Achievements.AchievementData).length;
                    sendMessage.push(achievementLength);
                    for (i = 0; i < achievementLength; ++i) {
                        sendMessage.push(self.achievement[i].found);
                        sendMessage.push(self.achievement[i].progress);
                    }

                    self.send(sendMessage);

                    self.reviewSkills();

                    databaseHandler.loadPets(self, function (kinds) {
                        for (var index = 0; index < kinds.length; index++) {
                            if (kinds[index])
                                var pet = self.server.addPet(self, kinds[index], self.x, self.y);
                        }
                    });

                });
            });
        });

        self.hasEnteredGame = true;
        self.isDead = false;
    },

    canEquipArmor: function (itemKind) {
        var armourLevel = ItemTypes.getArmorLevel(itemKind);

        if (this.name == "Test")
            return true;

        if (armourLevel * 2 > this.level) {
            this.server.pushToPlayer(this, new Messages.GuiNotify("You need to be at least level " + armourLevel * 2 + " to equip this."));
            return false;
        }

        return true;
    },

    canEquipWeapon: function (itemKind) {
        var weaponLevel = ItemTypes.getWeaponLevel(itemKind);

        if (this.name == "Test")
            return true;

        if (weaponLevel * 2 > this.level) {
            this.server.pushToPlayer(this, new Messages.GuiNotify("You need to be at least level " + weaponLevel * 2 + " to wield this."));
            return false;
        }

        /*if ((ItemTypes.isWeapon(itemKind) && (this.pClass != Types.PlayerClass.FIGHTER && this.pClass != Types.PlayerClass.DEFENDER)) ||
         (ItemTypes.isArcherWeapon(itemKind) && this.pClass != Types.PlayerClass.ARCHER)) {

         this.server.pushToPlayer(this, new Messages.GuiNotify("Your class cannot wield this weapon."));
         return false;
         }*/

        return true;
    },

    canEquipPendant: function (itemKind) {
        var pendantLevel = ItemTypes.getPendantLevel(itemKind);

        var achievement = Achievements.AchievementData[23];

        if (this.achievement[23].progress != 999) {
            this.server.pushToPlayer(this, new Messages.GuiNotify("You must have completed: " + achievement.name + " to equip this."));
            return false;
        }

        if (pendantLevel * 2 > this.level) {
            this.server.pushToPlayer(this, new Messages.GuiNotify("You need to be at least level " + (pendantLevel * 2) + " to equip this."));
            return false;
        }

        return true;
    },

    canEquipRing: function (itemKind) {
        var ringLevel = ItemTypes.getRingLevel(itemKind);

        var achievement = Achievements.AchievementData[20];

        if (this.achievement[20].progress != 999) {
            this.server.pushToPlayer(this, new Messages.GuiNotify("You must have completed: " + achievement.name + " to equip this."));
            return false;
        }

        if (ringLevel * 2 > this.level) {
            this.server.pushToPlayer(this, new Messages.GuiNotify("You need to be at least level " + (ringLevel * 2) + " to equip this."));
            return false;
        }

        return true;
    },

   //TODO: convert all unequip functions into a single one.

    handleInventoryWeaponUnequip: function () {
        var self = this;

        log.info('Unequipping???');

        if (!self.inventory.hasSpace()) {
            self.packetHandler.sendGUIMessage('You do not have any space in your inventory.');
            return false;
        }

        self.inventory.add(self.weapon, self.weaponEnchantedPoint, self.weaponSkillKind, self.weaponSkillLevel);
        self.unequipItem(self.weapon);


        self.packetHandler.broadcast(self.equip(-1), false);

        return true;
    },

    handleInventoryArmorUnequip: function () {
        var self = this;

        if (!self.inventory.hasSpace()) {
            self.packetHandler.sendGUIMessage('You do not have any space in your inventory.');
            return false;
        }

        self.inventory.add(self.armor, self.armorEnchantedPoint, self.armorSkillKind, self.armorSkillLevel);
        self.unequipItem(self.armor);

        self.packetHandler.broadcast(self.equip(-2), false);

        return true;
    },

    handleInventoryPendantUnequip: function () {
        var self = this;

        if (!self.inventory.hasSpace()) {
            self.packetHandler.sendGUIMessage('You do not have any space in your inventory.');
            return false;
        }

        self.inventory.add(self.pendant, self.pendantEnchantedPoint, self.pendantSkillKind, self.pendantSkillLevel);
        self.unequipItem(self.pendant);

        self.packetHandler(self.equip(-3), false);

        return true;
    },

    handleInventoryRingUnequip: function () {
        var self = this;

        if (!self.inventory.hasSpace()) {
            self.packetHandler.sendGUIMessage('You do not have any space in your inventory.');
            return false;
        }

        self.inventory.add(self.ring, self.ringEnchantedPoint, self.ringSkillKind, self.ringSkillLevel);
        self.unequipItem(self.ring);

        self.packetHandler.broadcast(self.equip(-4), false);

        return true;
    },

    handleInventoryWeapon: function (itemKind, inventoryNumber) {
        var self = this;

        log.info('Weapon: ' + inventoryNumber);

        if (inventoryNumber == -1) {
            self.handleInventoryWeaponUnequip();
            return;
        }
        
        if (!self.canEquipWeapon(itemKind))
            return;

        var enchantedPoints = self.inventory.slots[inventoryNumber].count,
            skillKind = self.inventory.slots[inventoryNumber].skillKind,
            skillLevel = self.inventory.slots[inventoryNumber].skillLevel;

        self.inventory.empty(inventoryNumber);

        self.equipItem(itemKind, enchantedPoints, skillKind, skillLevel, false);
        
        self.setAbility();
        self.packetHandler.broadcast(self.equip(itemKind), false);
        
        if (self.equipWeapon_callback)
            self.equipWeapon_callback(itemKind);
    },

    handleInventoryArmor: function (itemKind, inventoryNumber) {
        if (inventoryNumber == -2) {
            this.handleInventoryArmorUnequip();
            return;
        }

        if (!this.canEquipArmor(itemKind)) {
            return;
        }

        //log.info("itemEnchantedLevel="+this.inventory.rooms[inventoryNumber].itemNumber);
        var itemEnchantedLevel = this.inventory.rooms[inventoryNumber].itemNumber;
        var itemSkillKind = this.inventory.rooms[inventoryNumber].itemSkillKind;
        var itemSkillLevel = this.inventory.rooms[inventoryNumber].itemSkillLevel;

        this.inventory.setInventory(inventoryNumber, this.armor, this.armorEnchantedPoint, this.armorSkillKind, this.armorSkillLevel);
        this.equipItem(itemKind, itemEnchantedLevel, itemSkillKind, itemSkillLevel, false);
        this.packetHandler.broadcast(this.equip(itemKind), false);
    },

    handleInventoryPendant: function (itemKind, inventoryNumber) {
        if (inventoryNumber == -3) {
            this.handleInventoryPendantUnequip();
            return;
        }

        if (!this.canEquipPendant(itemKind))
            return;

        var enchantedPoint = this.inventory.rooms[inventoryNumber].itemNumber;
        var pendantSkillKind = this.inventory.rooms[inventoryNumber].itemSkillKind;
        var pendantSkillLevel = this.inventory.rooms[inventoryNumber].itemSkillLevel;

        this.inventory.setInventory(inventoryNumber, this.pendant, this.pendantEnchantedPoint, this.pendantSkillKind, this.pendantSkillLevel);

        this.equipItem(itemKind, enchantedPoint, pendantSkillKind, pendantSkillLevel, false);
        this.setAbility();

        this.packetHandler.broadcast(this.equip(itemKind), false);
    },

    hasPendant: function () {
        return this.pendant != 0;
    },

    getPendant: function () {
        return this.pendant;
    },

    hasRing: function () {
        return this.ring != 0;
    },

    getRing: function () {
        return this.ring;
    },


    handleInventoryRing: function (itemKind, inventoryNumber) {
        if (inventoryNumber == -4) {
            this.handleInventoryRingUnequip();
            return;
        }

        if (!this.canEquipRing(itemKind))
            return;

        var enchantedPoint = this.inventory.rooms[inventoryNumber].itemNumber;
        var ringSkillKind = this.inventory.rooms[inventoryNumber].itemSkillKind;
        var ringSkillLevel = this.inventory.rooms[inventoryNumber].itemSkillLevel;

        this.inventory.setInventory(inventoryNumber, this.ring, this.ringEnchantedPoint, this.ringSkillKind, this.ringSkillLevel);

        this.equipItem(itemKind, enchantedPoint, ringSkillKind, ringSkillLevel, false);
        this.setAbility();

        this.packetHandler.broadcast(this.equip(itemKind), false);
    },

    handleInventoryEmpty: function (kind, index, count) {
        var self = this,
            item = self.server.addItemFromChest(kind, self.x, self.y),
            inventoryItem = self.inventory.slots[index];


        if (ItemTypes.isConsumableItem(item.kind) || ItemTypes.isGold(item.kind)) {

            if (count > inventoryItem.count)
                count = inventoryItem.count;
            else if (count < 0)
                count = 0;

            item.count = count;

        } else if (ItemTypes.isEitherArmor(item.kind) || ItemTypes.isEitherArmor(item.kind) || ItemTypes.isPendant(item.kind) || ItemTypes.isRing(item.kind)) {

            switch(index) {
                case -1:

                    item.count = self.weaponEnchantedPoint;
                    item.skillKind = self.weaponSkillKind;
                    item.skillLevel = self.weaponSkillLevel;

                    break;

                case -2:

                    item.count = self.armorEnchantedPoint;
                    item.skillKind = self.armorSkillKind;
                    item.skillLevel = self.armorSkillLevel;

                    break;

                case -3:

                    item.count = self.pendantEnchantedPoint;
                    item.skillKind = self.pendantSkillKind;
                    item.skillLevel = self.pendantSkillLevel;

                    break;

                case -4:

                    item.count = self.ringEnchantedPoint;
                    item.skillKind = self.ringSkillKind;
                    item.skillLevel = self.ringSkillLevel;

                    break;

                default:

                    if (index < 0 || index == 0)
                        return;

                    item.count = inventoryItem.count;
                    item.skillKind = inventoryItem.skillKind;
                    item.skillLevel = inventoryItem.skillLevel;

                    break;

            }
        }

        if (item.count > 0) {

            self.server.pushToAdjacentGroups(self.group, new Messages.Drop(self, item));
            self.server.handleItemDespawn(item);

            switch(index) {

                case -1:
                    self.unequipItem(self.weapon);
                    self.packetHandler.broadcast(self.equip(index), false);
                    break;

                case -2:
                    self.unequipItem(self.armor);
                    self.packetHandler.broadcast(self.equip(index), false);
                    break;

                case -3:
                    self.unequipItem(self.pendant);
                    self.packetHandler.broadcast(self.equip(index), false);
                    break;

                case -4:
                    self.unequipItem(self.ring);
                    self.packetHandler.broadcast(self.equip(index), false);
                    break;

                default:

                    if (index < 0)
                        return;

                    if (ItemTypes.isConsumableItem(item.kind) || ItemTypes.isGold(item.kind) || ItemTypes.isCraft(item.kind))
                        self.inventory.remove(item.kind, item.count);
                    else
                        self.inventory.empty(index);

                    break;

            }

        } else {
            self.server.removeEntity(item);
            self.inventory.empty(index);
        }
    },
    handleInventoryEat: function (itemKind, inventoryNumber) {
        var self = this;

        if (self.consumeTimeout)
            return;

        self.consumeTimeout = setTimeout(function() {
            self.consumeTimeout = null;
        }, 4000);

        switch (itemKind) {

            case 212:

                self.packetHandler.broadcast(self.equip(213), false);

                if (self.royalAzaleaBenefTimeout)
                    clearTimeout(self.royalAzaleaBenefTimeout);

                self.royalAzaleaBenefTimeout = setTimeout(function() {
                    self.royalAzaleaBenefTimeout = null;
                }, 15000);

                break;

            case 300:

                if (!self.hasFullMana()) {
                    self.regenManaBy(75);
                    self.server.pushToPlayer(self, new Messages.Mana(self.mana));
                }

                break;

            default:

                var healingAmount;

                if (itemKind == 35)
                    healingAmount = 100;
                else if (itemKind == 200)
                    healingAmount = 200;
                else if (itemKind == 401)
                    healingAmount = ~~(self.maxHitPoints * 0.35);

                if (!self.hasFullHealth()) {
                    self.regenHealthBy(healingAmount);
                    self.server.pushToPlayer(self, self.health());
                }

                break;
        }

        if (self.healing_callback)
            self.healing_callback(itemKind);

        self.inventory.takeOutInventory(inventoryNumber, 1);
    },

    handleInventoryEnchantWeapon: function (itemKind, inventoryNumber) {
        if (itemKind !== 200) { // SNOWPOTION
            this.server.pushToPlayer(this, new Messages.Notify("This isn't a snowpotion."));
            return;
        }
        if (this.weaponEnchantedPoint + this.weaponSkillLevel >= 30) {
            this.server.pushToPlayer(this, new Messages.Notify("Weapon Enchantment cannot exceed 30."));
            return;
        }
        this.inventory.makeEmptyInventory(inventoryNumber);
        if (Utils.ratioToBool(0.1)) {
            this.server.pushToPlayer(this, new Messages.Notify("Your enchantment succeeded."));
            if (this.weaponEnchantedPoint) {
                this.weaponEnchantedPoint += 1;
            } else {
                this.weaponEnchantedPoint = 1;
            }
            databaseHandler.enchantWeapon(this.name, this.weaponEnchantedPoint);
        } else {
            this.server.pushToPlayer(this, new Messages.Notify("Your enchantment Failed."));
        }
    },
    handleInventoryEnchantBloodsucking: function (itemKind, inventoryNumber) {
        if (itemKind !== 306) { // BLACKPOTION
            this.server.pushToPlayer(this, new Messages.Notify("This isn't a black potion."));
            return;
        }
        if (this.weaponEnchantedPoint + this.weaponSkillLevel >= 30) {
            this.server.pushToPlayer(this, new Messages.Notify("Weapon enchantment cannot exceed level 30."));
            return;
        }
        if (this.weaponSkillLevel >= 7) {
            this.server.pushToPlayer(this, new Messages.Notify("Weapon Skill Level cannot be raised beyond 7."));
            return;
        }
        if (this.weaponSkillKind !== Types.Skills.BLOODSUCKING) {
            this.server.pushToPlayer(this, new Messages.Notify("You can use a black potion.")); //NOTE - Not sure about this
            return;
        }

        this.inventory.makeEmptyInventory(inventoryNumber);
        if (Utils.ratioToBool(0.1)) {

            this.server.pushToPlayer(this, new Messages.Notify("Enchantment successful."));
            this.weaponSkillKind = Types.Skills.BLOODSUCKING;

            if (this.weaponSkillLevel)
                this.weaponSkillLevel += 1;
            else
                this.weaponSkillLevel = 1;

            databaseHandler.setWeaponSkill(this.name, this.weaponSkillKind, this.weaponSkillLevel);

        } else
            this.server.pushToPlayer(this, new Messages.Notify("The enchantment failed."));
    },

    setAbility: function () {
        this.bloodsuckingRatio = 0;
        if (this.weaponSkillKind === Types.Skills.BLOODSUCKING)
            this.bloodsuckingRatio += this.weaponSkillLevel * 0.02;

        this.criticalRatio = 0;
        if (this.skillHandler.getLevel("criticalStrike") > 0)
            this.criticalRatio = 0.1;

        if (this.weaponSkillKind === Types.Skills.CRITICALRATIO)
            this.criticalRatio += this.weaponSkillLevel * 0.01;
    },

    isAdmin: function () {
        if (this.name == "Tachyon")
            return true;

        return false;
    },

    hasPet: function (pet) {
        for (var i = 0; i < this.pets.length; ++i) {
            if (pet === this.pets[i])
                return true;
        }
        return false;
    },

    isPoisoned: function () {
        return this.poisoned;
    },

    setPoison: function (state) {
        var self = this;
        self.server.pushToPlayer(self, new Messages.Poison(state));
        self.poisoned = state;
        self.redisPool.setPoison(state);
    },

    getHp: function () {
        switch (this.pClass) {
            case Types.PlayerClass.FIGHTER:
                return 50 + (this.level * 25);

            case Types.PlayerClass.DEFENDER:
                return 60 + (this.level * 30);

            case Types.PlayerClass.MAGE:
                return 40 + (this.level * 18);

            case Types.PlayerClass.ARCHER:
                return 45 + (this.level * 16);

            default:
                return 40 + (this.level * 10);
        }
    },

    reviewSkills: function () {
        var self = this,
            skillHandler = self.skillHandler,
            achievements = Achievements.AchievementData,
            index = 0,
            skills = [];

        for (var a in achievements) {
            if (achievements.hasOwnProperty(a)) {
                if (self.achievement[index].progress == 999 && achievements[a].skillName) {
                    skills.push({
                        name: achievements[a].skillName,
                        level: achievements[a].skillLevel
                    });
                }
                index++;
            }
        }

        for (var index = 0; index < skills.length; index++) {
            var name = skills[index].name,
                level = skills[index].level;

            self.skillHandler.add(name, level);
        }
    },

    finishAllAchievements: function () {
        var self = this,
            index = 0;

        for (var a in Achievements.AchievementData) {
            var achievement = self.achievement[index];

            achievement.progress = 999;
            self.redisPool.progressAchievement(self.name, index, 999);
            index++;
        }
    },

    finishAchievement: function (achievementId) {
        var self = this,
            achievement = self.achievement[achievementId];

        achievement.progress = 999;
        self.redisPool.progressAchievement(self.name, achievementId, 999);
    },

    getMp: function () {
        if (this.pClass == Types.PlayerClass.FIGHTER)
            return 15 + (this.level * 8);

        if (this.pClass == Types.PlayerClass.DEFENDER)
            return 25 + (this.level * 3);

        if (this.pClass == Types.PlayerClass.MAGE)
            return 30 + (this.level * 12);

        if (this.pClass == Types.PlayerClass.ARCHER)
            return 10 + (this.level * 7);


        return 40 + (this.level * 10);
    },

    setActiveSkill: function (skillId) {
        this.activeSkill = skillId;
    },

    resetActiveSkill: function () {
        this.activeSkill = 0;
    },

    getActiveSkill: function () {
        return this.activeSkill;
    },

    forcefullyTeleport: function (x, y, orientation) {
        var self = this;

        log.info("Teleporting: " + self.name);

        self.server.pushToPlayer(self, new Messages.Stop(x, y, orientation));
    },

    getActivityExp: function(activityId) {
        //Handle it in redis later, fine for now.
        
    },

    setTeam: function (team) {
        this.minigameTeam = team;
    },

    getTeam: function () {
        return this.minigameTeam;
    },
    
    finishedTutorial: function() {
        return this.questHandler.getQuest('A Great Start').stage == 9999;
    },

    setPVPKills: function (kills) {
        this.pvpKills = kills;
        this.redisPool.setPVPKills(this.name, this.pvpKills);
    },

    addPVPKill: function () {
        this.pvpKills += 1;
        this.redisPool.setPVPKills(this.name, this.pvpKills);
        log.info("PVP Kills: " + this.pvpKills);
    },

    setPVPDeaths: function (deaths) {
        this.pvpDeaths = deaths;
        this.redisPool.setPVPDeaths(this.name, this.pvpDeaths);
    },

    addPVPDeath: function () {
        this.pvpDeaths += 1;
        this.redisPool.setPVPDeaths(this.name, this.pvpDeaths);
    },
    
    onEquipWeapon: function(callback) {
        this.equipWeapon_callback = callback;
    },
    
    onHealPotion: function(callback) {
        this.healing_callback = callback;
    }
});
