/* eslint-disable no-unused-vars */
/* eslint-disable react/jsx-no-undef */
/* eslint-disable no-undef */
class AccountWrapperAsset extends React.Component {
  render() {
    const { balance, jsonStrings } = this.props;

    return (
      <div className='account-wrapper-asset pt-2 pl-2 pr-2 pb-0'>
        <div className='account-wrapper-body'>
          <div className='account-asset-coin'>{balance.asset}</div>
          <div className='account-asset-row'>
            <span className='account-asset-label'>
              {jsonStrings[0]._total}:
            </span>
            <span className='account-asset-value'>
              {(parseFloat(balance.free) + parseFloat(balance.locked)).toFixed(
                5
              )}
            </span>
          </div>
          <div className='account-asset-row'>
            <span className='account-asset-label'>{jsonStrings[0]._free}:</span>
            <span className='account-asset-value'>
              {parseFloat(balance.free).toFixed(5)}
            </span>
          </div>
          <div className='account-asset-row'>
            <span className='account-asset-label'>
              {jsonStrings[0]._locked}:
            </span>
            <span className='account-asset-value'>
              {parseFloat(balance.locked).toFixed(5)}
            </span>
          </div>
        </div>
      </div>
    );
  }
}
