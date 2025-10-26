import axios from "axios";
import { io, Socket } from 'socket.io-client';
import { validateEnv } from "../env-validator";
import { sendTelegramMessage } from "../notification";

interface Position {
  id: string | number;
  tokenAddress: string; // Changé de 'token' vers 'tokenAddress'
  initialSolAmountUi: number; // Changé de 'amount' vers 'initialSolAmountUi'
  autoSellSettings?: {
    initialPriceExpressedInUsd: string;
    highestPriceExpressedInUsd?: string;
    strategy?: {
      strategyName: string;
      profitPercentage: number;
      stopLossPercentage: number;
    };
  };
  isOpen: boolean; // Changé de 'status' vers 'isOpen'
  createdAt: string; // Changé de 'created_at' vers 'createdAt'
  updatedAt: string; // Changé de 'updated_at' vers 'updatedAt'
  tokenExtraInfo?: {
    tokenSymbol: string;
    tokenName?: string;
    tokenImage?: string;
  };
  closedAt?: string | null;
  closedBy?: string | null; // Ajouté pour savoir comment la position a été fermée
  oneSolPriceInUSDAtCreation?: string;
  oneSolPriceInUSDAtClosing?: string | null;
  initialSolAmount?: string; // Ajouté pour le montant en lamports
  initialTokenAmount?: string; // Ajouté pour le montant initial de tokens
  amountOfTokensSold?: string; // Ajouté pour le montant de tokens vendus
  // Champs calculés pour compatibilité
  amount?: number;
  entry_price?: number;
  current_price?: number;
  pnl?: number;
  status?: 'open' | 'closed' | 'partial';
  created_at?: string;
  updated_at?: string;
  token?: string;
}

interface Order {
  id: string;
  position_id?: string;
  type: 'buy' | 'sell';
  amount: number;
  price?: number;
  status: 'created' | 'executed' | 'failed' | 'expired' | 'cancelled';
  created_at: string;
  updated_at: string;
  orderType?: string;
}

interface OrderEventData {
  order: {
    order: Order;
    tokenExtraInfo: {
      tokenSymbol: string;
    };
  };
}

interface PositionEventData {
  positionWithTransactions?: Position;
  position?: Position;
  type?: string;
  toastFrontendId?: string;
  positionTransaction?: {
    positionId: string;
    transactionId: string;
  };
}

export class SniperooHandler {
  private ordersSocket: Socket | null = null;
  private positionsSocket: Socket | null = null;
  private apiToken: string;
  private serverUrl = 'wss://api.sniperoo.app';
  private positions: Map<string, Position> = new Map();
  private orders: Map<string, Order> = new Map();

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async connect(): Promise<void> {
    console.log('🔗 Connecting to Sniperoo API...');

    return new Promise((resolve, reject) => {
      try {
        // Create connections to both orders and positions
        this.ordersSocket = io(`${this.serverUrl}/orders`, {
          transports: ['websocket'],
          timeout: 20000
        });

        this.positionsSocket = io(`${this.serverUrl}/positions`, {
          transports: ['websocket'],
          timeout: 20000
        });

        let connectionsReady = 0;
        const totalConnections = 2;

        const checkAllConnected = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            console.log('✅ Connected to Sniperoo API');
            resolve();
          }
        };

        // Handle orders socket connection
        this.ordersSocket.on('connect', () => {
          console.log('✅ Orders socket connected');
          this.subscribeToOrders();
          checkAllConnected();
        });

        // Handle positions socket connection
        this.positionsSocket.on('connect', () => {
          console.log('✅ Positions socket connected');
          this.subscribeToPositions();
          checkAllConnected();
        });

        // Setup event handlers
        this.setupOrderEvents();
        this.setupPositionEvents();
        this.setupDisconnectionHandlers();

        // Handle errors
        this.ordersSocket.on('connect_error', (error: Error) => {
          console.error('❌ Orders connection error:', error.message);
          reject(error);
        });

        this.positionsSocket.on('connect_error', (error: Error) => {
          console.error('❌ Positions connection error:', error.message);
          reject(error);
        });

        // Add timeout for connection
        setTimeout(() => {
          if (connectionsReady < totalConnections) {
            reject(new Error('Connection timeout after 30 seconds'));
          }
        }, 30000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private async subscribeToOrders(): Promise<void> {
    if (!this.ordersSocket) return;

    try {
      const activeOrders = await this.ordersSocket.emitWithAck('subscribe_orders_api', {
        apiKey: this.apiToken
      });

      if (activeOrders && activeOrders['orders']) {
        console.log(`📋 Loaded ${activeOrders['orders'].length} active orders`);

        activeOrders['orders'].forEach((order: Order) => {
          this.orders.set(order.id, order);
        });
      }

    } catch (error) {
      console.error('❌ Error subscribing to orders:', error instanceof Error ? error.message : error);
    }
  }

  private async subscribeToPositions(): Promise<void> {
    if (!this.positionsSocket) return;

    try {
      const res = await this.positionsSocket.emitWithAck('subscribe_positions_api', {
        apiKey: this.apiToken
      });

      if (res && res['openPositions']) {
        console.log(`📈 Loaded ${res['openPositions'].length} open positions`);

        res['openPositions'].forEach((position: Position) => {
          this.positions.set(String(position.id), position);
        });
      }

    } catch (error) {
      console.error('❌ Error subscribing to positions:', error instanceof Error ? error.message : error);
    }
  }

  private setupOrderEvents(): void {
    if (!this.ordersSocket) return;

    this.ordersSocket.on('order_created', (data: OrderEventData) => {
      const order = data.order.order;
      this.orders.set(order.id, order);
      console.log('🆕 New order created:', `#${order.id} ${order.orderType} ${data.order.tokenExtraInfo.tokenSymbol}`);
    });

    this.ordersSocket.on('order_executed', (data: { order: Order }) => {
      this.orders.set(data.order.id, { ...data.order, status: 'executed' });
      console.log('✅ Order executed:', `#${data.order.id}`);
    });

    this.ordersSocket.on('order_cancelled', (data: { order: Order }) => {
      this.orders.set(data.order.id, { ...data.order, status: 'cancelled' });
      console.log('❌ Order cancelled:', `#${data.order.id}`);
    });

    this.ordersSocket.on('order_failed', (data: { order: Order }) => {
      this.orders.set(data.order.id, { ...data.order, status: 'failed' });
      console.log('💥 Order failed:', `#${data.order.id}`);
    });

    this.ordersSocket.on('order_expire', (data: { order: Order }) => {
      this.orders.set(data.order.id, { ...data.order, status: 'expired' });
      console.log('⏰ Order expired:', `#${data.order.id}`);
    });
  }

  private setupPositionEvents(): void {
    if (!this.positionsSocket) return;

    this.positionsSocket.on('position_created', async (data: PositionEventData) => {
      if (data.positionWithTransactions) {
        const position = data.positionWithTransactions;

        // Normaliser les données pour compatibilité
        const normalizedPosition: Position = {
          ...position,
          // Mapping des champs
          amount: position.initialSolAmountUi || 0,
          entry_price: position.autoSellSettings?.initialPriceExpressedInUsd ?
            parseFloat(position.autoSellSettings.initialPriceExpressedInUsd) : 0,
          current_price: position.autoSellSettings?.highestPriceExpressedInUsd ?
            parseFloat(position.autoSellSettings.highestPriceExpressedInUsd) : 0,
          status: position.isOpen ? 'open' : 'closed',
          created_at: position.createdAt,
          updated_at: position.updatedAt,
          token: position.tokenAddress
        };

        this.positions.set(String(position.id), normalizedPosition);

        const tokenSymbol = position.tokenExtraInfo?.tokenSymbol || position.tokenExtraInfo?.tokenName || 'Unknown';
        console.log('🆕 New position:', `#${position.id} ${tokenSymbol}`);

        // Debug: Log the actual position data received
        console.log('🔍 [DEBUG] Position data received:', JSON.stringify(position, null, 2));

        // Send Telegram notification for new position with corrected field mapping
        const entryPrice = position.autoSellSettings?.initialPriceExpressedInUsd ?
          parseFloat(position.autoSellSettings.initialPriceExpressedInUsd) : 0;
        const amount = position.initialSolAmountUi || 0;
        const solPriceAtCreation = position.oneSolPriceInUSDAtCreation ?
          parseFloat(position.oneSolPriceInUSDAtCreation) : 0;

        const message = `🆕 <b>Nouvelle Position Ouverte!</b>

🪙 <b>Token:</b> ${tokenSymbol}
📝 <b>ID Position:</b> <code>${position.id}</code>
💰 <b>Montant:</b> ${amount.toFixed(4)} SOL (~$${(amount * solPriceAtCreation).toFixed(2)})
💵 <b>Prix d'entrée:</b> $${entryPrice.toFixed(8)}
📊 <b>Statut:</b> ${position.isOpen ? 'Ouvert' : 'Fermé'}
🕐 <b>Créé:</b> ${new Date(position.createdAt).toLocaleString('fr-FR')}

🔗 <b>Token CA:</b> <code>${position.tokenAddress}</code>
📊 <b>Prix SOL:</b> $${solPriceAtCreation.toFixed(2)}`;

        await sendTelegramMessage(message);
      }
    });

    this.positionsSocket.on('position_updated', async (data: PositionEventData) => {
      if (data.position) {
        const oldPosition = this.positions.get(String(data.position.id));

        // Normalize the updated position
        const normalizedPosition: Position = {
          ...data.position,
          amount: data.position.initialSolAmountUi || 0,
          entry_price: data.position.autoSellSettings?.initialPriceExpressedInUsd ?
            parseFloat(data.position.autoSellSettings.initialPriceExpressedInUsd) : 0,
          current_price: data.position.autoSellSettings?.highestPriceExpressedInUsd ?
            parseFloat(data.position.autoSellSettings.highestPriceExpressedInUsd) : 0,
          status: data.position.isOpen ? 'open' : 'closed',
          created_at: data.position.createdAt,
          updated_at: data.position.updatedAt,
          token: data.position.tokenAddress
        };

        // Debug: Log position update details
        console.log('🔍 [DEBUG] Position update received for:', data.position.id);
        console.log('🔍 [DEBUG] Old isOpen:', oldPosition?.isOpen);
        console.log('🔍 [DEBUG] New isOpen:', data.position.isOpen);
        console.log('🔍 [DEBUG] Position update data:', JSON.stringify(data, null, 2));

        this.positions.set(String(data.position.id), normalizedPosition);

        // Récupérer le nom du token depuis la position stockée ou utiliser l'adresse
        const tokenSymbol = oldPosition?.tokenExtraInfo?.tokenSymbol ||
                           oldPosition?.tokenExtraInfo?.tokenName ||
                           data.position.tokenExtraInfo?.tokenSymbol ||
                           data.position.tokenExtraInfo?.tokenName ||
                           data.position.tokenAddress.substring(0, 8) + '...';

        console.log('📈 Position updated:', `#${data.position.id}`);

        // Send notification if position was closed
        if (oldPosition && oldPosition.isOpen && !data.position.isOpen) {
          console.log('💡 [DEBUG] Position status changed from open to closed');

          // Calculer le P&L basé sur les montants SOL réels
          const initialSolAmount = data.position.initialSolAmount ?
            parseInt(data.position.initialSolAmount) / 1000000000 : // Convertir de lamports vers SOL
            (data.position.initialSolAmountUi || 0);

          const solPriceAtCreation = data.position.oneSolPriceInUSDAtCreation ?
            parseFloat(data.position.oneSolPriceInUSDAtCreation) : 0;
          const solPriceAtClosing = data.position.oneSolPriceInUSDAtClosing ?
            parseFloat(data.position.oneSolPriceInUSDAtClosing) : solPriceAtCreation;

          // Valeur initiale en USD
          const initialValueUsd = initialSolAmount * solPriceAtCreation;

          // Prix des tokens en USD (souvent identiques, donc pas fiables)
          const entryPrice = data.position.autoSellSettings?.initialPriceExpressedInUsd ?
            parseFloat(data.position.autoSellSettings.initialPriceExpressedInUsd) : 0;
          const currentPrice = data.position.autoSellSettings?.highestPriceExpressedInUsd ?
            parseFloat(data.position.autoSellSettings.highestPriceExpressedInUsd) : entryPrice;

          // Calculer la performance SOL
          const solPriceChangePercent = solPriceAtCreation > 0 ?
            ((solPriceAtClosing - solPriceAtCreation) / solPriceAtCreation * 100) : 0;

          // Nouvelle méthode : estimer la performance token basée sur les données disponibles
          let tokenPriceChangePercent = 0;
          let estimatedTokenPerformance = 0;

          // Si les prix token sont différents, les utiliser
          if (entryPrice > 0 && Math.abs(currentPrice - entryPrice) > entryPrice * 0.0001) { // Plus de 0.01% de différence
            tokenPriceChangePercent = ((currentPrice - entryPrice) / entryPrice * 100);
          } else {
            // Sinon, estimer basé sur les données de position
            const initialTokenAmount = data.position.initialTokenAmount ?
              parseFloat(data.position.initialTokenAmount) : 0;
            const amountSold = data.position.amountOfTokensSold ?
              parseFloat(data.position.amountOfTokensSold) : 0;

            // Si c'est une fermeture manuelle et qu'aucun token n'a été vendu,
            // on peut assumer que la performance est principalement due au SOL
            // Sinon, utiliser une estimation basée sur le timing et les conditions de marché
            if (data.position.closedBy === 'manual' && amountSold === 0) {
              // Position fermée manuellement sans vente = probablement neutre ou légèrement positive
              estimatedTokenPerformance = 0; // Neutre pour le token
            } else if (data.position.closedBy === 'stop_loss') {
              // Stop loss déclenché = perte
              estimatedTokenPerformance = -(data.position.autoSellSettings?.strategy?.stopLossPercentage || 10);
            } else if (data.position.closedBy === 'take_profit') {
              // Take profit déclenché = gain
              estimatedTokenPerformance = (data.position.autoSellSettings?.strategy?.profitPercentage || 10);
            }

            tokenPriceChangePercent = estimatedTokenPerformance;
          }

          // Le P&L total combine les effets SOL et token
          const totalPnlPercent = solPriceChangePercent + tokenPriceChangePercent;
          const finalValueUsd = initialValueUsd * (1 + totalPnlPercent / 100);
          const totalPnlUsd = finalValueUsd - initialValueUsd;

          const pnlEmoji = totalPnlUsd >= 0 ? '💚' : '❌';
          const pnlSign = totalPnlUsd >= 0 ? '+' : '';

          // Informations sur la fermeture
          const closedBy = data.position.closedBy || 'auto';
          const closedReason = closedBy === 'manual' ? 'Manuelle' :
                              closedBy === 'stop_loss' ? 'Stop Loss' :
                              closedBy === 'take_profit' ? 'Take Profit' : 'Auto';

          // Construire le message avec les informations disponibles
          let performanceDetails = `${pnlEmoji} <b>Performance SOL:</b> ${solPriceChangePercent >= 0 ? '+' : ''}${solPriceChangePercent.toFixed(2)}%`;

          if (Math.abs(tokenPriceChangePercent) > 0.01) {
            const tokenEmoji = tokenPriceChangePercent >= 0 ? '💚' : '❌';
            const tokenSign = tokenPriceChangePercent >= 0 ? '+' : '';
            performanceDetails += `\n${tokenEmoji} <b>Performance Token:</b> ${tokenSign}${tokenPriceChangePercent.toFixed(2)}%`;

            if (estimatedTokenPerformance !== 0) {
              performanceDetails += ` (estimée)`;
            }
          }

          // Calculer la durée de la position
          const createdAt = new Date(data.position.createdAt);
          const closedAt = new Date(data.position.closedAt || data.position.updatedAt);
          const durationMs = closedAt.getTime() - createdAt.getTime();
          const durationMinutes = Math.floor(durationMs / (1000 * 60));
          const durationSeconds = Math.floor((durationMs % (1000 * 60)) / 1000);
          const durationText = durationMinutes > 0 ? `${durationMinutes}m ${durationSeconds}s` : `${durationSeconds}s`;

          const message = `${pnlEmoji} <b>Position Fermée!</b>

🪙 <b>Token:</b> ${tokenSymbol}
📝 <b>ID Position:</b> <code>${data.position.id}</code>
💰 <b>Montant:</b> ${initialSolAmount.toFixed(4)} SOL
⏱️ <b>Durée:</b> ${durationText}

💵 <b>Prix Token Entrée:</b> $${entryPrice.toFixed(8)}
💵 <b>Prix Token Sortie:</b> $${currentPrice.toFixed(8)}

${performanceDetails}
${pnlEmoji} <b>P&L Total:</b> ${pnlSign}${totalPnlPercent.toFixed(2)}% (${pnlSign}$${Math.abs(totalPnlUsd).toFixed(4)})

📊 <b>SOL Entrée:</b> $${solPriceAtCreation.toFixed(2)}
📊 <b>SOL Sortie:</b> $${solPriceAtClosing.toFixed(2)}

🎯 <b>Fermé par:</b> ${closedReason}
🕐 <b>Fermé:</b> ${closedAt.toLocaleString('fr-FR')}
🔗 <b>Token CA:</b> <code>${data.position.tokenAddress}</code>`;

          console.log('📨 [DEBUG] Sending close notification for position:', data.position.id);
          console.log('📊 [DEBUG] P&L Calculation:');
          console.log('   Initial SOL:', initialSolAmount, 'SOL');
          console.log('   SOL Price Change:', solPriceChangePercent.toFixed(2), '%');
          console.log('   Token Price Change:', tokenPriceChangePercent.toFixed(2), '% (estimated:', estimatedTokenPerformance !== 0, ')');
          console.log('   Closed By:', closedBy);
          console.log('   Duration:', durationText);
          console.log('   Initial Value:', initialValueUsd.toFixed(4), 'USD');
          console.log('   Final Value:', finalValueUsd.toFixed(4), 'USD');
          console.log('   Total P&L:', totalPnlPercent.toFixed(2), '%');

          await sendTelegramMessage(message);
        }
      }
    });

    this.positionsSocket.on('position_transaction_added', (data: PositionEventData) => {
      if (data.positionTransaction) {
        console.log('💰 New transaction:', `Position #${data.positionTransaction.positionId}`);
      }
    });
  }

  private setupDisconnectionHandlers(): void {
    this.ordersSocket?.on('disconnect', (reason: string) => {
      console.log('❌ Orders disconnected:', reason);
    });

    this.positionsSocket?.on('disconnect', (reason: string) => {
      console.log('❌ Positions disconnected:', reason);
    });
  }

  displayCurrentState(): void {
    console.log(`📊 Status: ${this.orders.size} orders, ${this.positions.size} positions tracked`);

    const activeOrders = this.getActiveOrders();
    const openPositions = this.getCurrentPositions();

    if (activeOrders.length > 0) {
      console.log(`  📋 ${activeOrders.length} active orders`);
    }

    if (openPositions.length > 0) {
      console.log(`  📈 ${openPositions.length} open positions`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ordersSocket) {
      this.ordersSocket.disconnect();
      this.ordersSocket = null;
    }

    if (this.positionsSocket) {
      this.positionsSocket.disconnect();
      this.positionsSocket = null;
    }

    console.log('👋 Disconnected from Sniperoo API');
  }

  // Utility methods to get current positions and orders - Updated to use correct fields
  getCurrentPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.isOpen === true);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getActiveOrders(): Order[] {
    return Array.from(this.orders.values()).filter(o => o.status === 'created');
  }

  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  getPositionById(id: string): Position | undefined {
    return this.positions.get(id);
  }

  getOrderById(id: string): Order | undefined {
    return this.orders.get(id);
  }
}

/**
 * Buys a token using the Sniperoo API
 * @param tokenAddress The token's mint address
 * @param inputAmount Amount of SOL to spend
 * @param returns Boolean indicating if the purchase was successful
 */
export async function buyToken(tokenAddress: string, inputAmount: number, sell: boolean, tp: number, sl: number): Promise<boolean> {
    try {
        const env = validateEnv();

        // Validate inputs
        if (!tokenAddress || typeof tokenAddress !== "string" || tokenAddress.trim() === "") {
            return false;
        }

        if (inputAmount <= 0) {
            return false;
        }

        if (!tp || !sl) {
            sell = false;
        }

        // Prepare request body
        const requestBody = {
            walletAddresses: [env.SNIPEROO_PUBKEY],
            tokenAddress: tokenAddress,
            inputAmount: inputAmount,
            isBuying: true,
            autoSell: {
                enabled: sell,
                strategy: {
                    strategyName: "simple",
                    profitPercentage: tp,
                    stopLossPercentage: sl,
                },
            },
        };

        // Make API request using axios
        const response = await axios.post(
            "https://api.sniperoo.app/trading/buy-token?toastFrontendId=0",
            requestBody,
            {
                headers: {
                    Authorization: `Bearer ${env.SNIPEROO_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        // Axios automatically throws an error for non-2xx responses,
        // so if we get here, the request was successful
        return true;
    } catch (error) {
        // Handle axios errors
        if (axios.isAxiosError(error)) {
            console.error(`Sniperoo API error (${error.response?.status || "unknown"}):`, error.response?.data || error.message);
        } else {
            console.error("Unexpected error:", error);
        }
        return false;
    }
}